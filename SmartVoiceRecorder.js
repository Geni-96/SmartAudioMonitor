class SmartVoiceRecorder {
  constructor(stream, options = {}) {
    this.stream = stream;
    this.options = {
      voiceThreshold: options.voiceThreshold || 15,
      silenceDuration: options.silenceDuration || 1500,
      minRecordingDuration: options.minRecordingDuration || 500,
      mimeType: options.mimeType || 'audio/webm'
    };
    this.audioContext = null;
    this.analyser = null;
    this.microphone = null;
    this.frequencyData = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.isMonitoring = false;
    this.silenceStart = null;
    this.currentRecordingStartTime = 0;
    this.totalRecordingTime = 0;
    this.eventListeners = {};
    if (this.stream) {
      this._initAudio();
    }
  }

  _initAudio() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    this.microphone = this.audioContext.createMediaStreamSource(this.stream);
    this.microphone.connect(this.analyser);
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: this.options.mimeType });
    this._setupRecorderEvents();
  }

  _setupRecorderEvents() {
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };
    this.mediaRecorder.onstop = () => {
      const duration = Date.now() - this.currentRecordingStartTime;
      if (duration >= this.options.minRecordingDuration) {
        this.totalRecordingTime += duration;
        this.emit('recordingComplete', {
          chunks: [...this.audioChunks],
          duration,
          timestamp: Date.now()
        });
      }
    };
  }

  computeFrequencyEnergy(frequencyData, minFreq, maxFreq, sampleRate) {
    const binSize = sampleRate / this.analyser.fftSize;
    const minBin = Math.floor(minFreq / binSize);
    const maxBin = Math.min(Math.ceil(maxFreq / binSize), frequencyData.length - 1);
    let sum = 0;
    for (let i = minBin; i <= maxBin; i++) {
      sum += frequencyData[i];
    }
    const numBins = maxBin - minBin + 1;
    return numBins > 0 ? (sum / numBins) : 0;
  }

  startMonitoring() {
    if (this.isMonitoring) return;
    this.isMonitoring = true;
    this._analyzeAudio();
    this.emit('monitoringStarted');
  }

  stopMonitoring() {
    if (!this.isMonitoring) return;
    if (this.isRecording) this.stopRecording();
    this.isMonitoring = false;
    if (this.microphone) this.microphone.disconnect();
    if (this.audioContext) this.audioContext.close();
    this.emit('monitoringStopped');
  }

  startRecording() {
    if (this.isRecording) return;
    this.audioChunks = [];
    this.mediaRecorder.start();
    this.isRecording = true;
    this.currentRecordingStartTime = Date.now();
    this.emit('recordingStarted');
  }

  stopRecording() {
    if (!this.isRecording) return;
    this.mediaRecorder.stop();
    this.isRecording = false;
    this.emit('recordingStopped');
  }

  _analyzeAudio = () => {
    if (!this.isMonitoring || !this.analyser) return;
    this.analyser.getByteFrequencyData(this.frequencyData);
    const sampleRate = this.audioContext.sampleRate;
    const rawAudioLevel = this.computeFrequencyEnergy(this.frequencyData, 0, sampleRate / 2, sampleRate);
    const speechEnergy = this.computeFrequencyEnergy(this.frequencyData, 85, 4000, sampleRate);
    this.emit('audioProcess', {
      rawLevel: rawAudioLevel,
      speechLevel: speechEnergy,
      timestamp: Date.now()
    });
    if (speechEnergy < this.options.voiceThreshold) {
      if (this.silenceStart === null) {
        this.silenceStart = performance.now();
      }
      if (this.isRecording && (performance.now() - this.silenceStart > this.options.silenceDuration)) {
        this.stopRecording();
        this.silenceStart = performance.now();
      }
    } else {
      this.silenceStart = null;
      if (!this.isRecording) {
        this.startRecording();
      }
    }
    requestAnimationFrame(this._analyzeAudio);
  }

  on(event, callback) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(callback);
  }

  off(event, callback) {
    if (this.eventListeners[event]) {
      this.eventListeners[event] = this.eventListeners[event].filter(cb => cb !== callback);
    }
  }

  emit(event, data) {
    if (this.eventListeners[event]) {
      this.eventListeners[event].forEach(callback => callback(data));
    }
  }

  dispose() {
    this.stopMonitoring();
    this.eventListeners = {};
  }
}
