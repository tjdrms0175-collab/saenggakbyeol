'use strict';

/* 생각별: children-first demo; no SDK or external resources required. */
(() => {
  const $ = (selector) => document.querySelector(selector);
  const nowDay = () => {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  };
  const SUBJECT_EMOJI = { 국어: '📖', 수학: '🔢', 사회: '🌍', 과학: '🔬', 영어: '🔤' };
  // Installable mobile PWA (same UI as v7). No API keys or learner content cached by the service worker.
  let installPrompt = null;
  function standalone() { return window.matchMedia('(display-mode: standalone)').matches || Boolean(navigator.standalone); }
  function toggleOfflineBanner() { $('#offlineBanner').hidden = navigator.onLine; }
  function closeInstallDialog() { $('#installModal').hidden = true; document.body.style.overflow = ''; }
  function showInstallInstructions() {
    if (standalone()) { showToast('이미 생각별 앱으로 실행 중이에요. 🌷'); return; }
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isAndroid = /Android/i.test(navigator.userAgent);
    const secure = window.isSecureContext;
    const msg = $('#installInstructions');
    if (!secure) msg.textContent = '휴대폰에서 앱을 설치하고 음성을 사용하려면 HTTPS 주소로 접속해 주세요. 노트북의 127.0.0.1 주소는 휴대폰에서 사용할 수 없어요.';
    else if (isIos) msg.textContent = '아이폰 Safari에서 공유(□↑) → 홈 화면에 추가 → 추가를 선택해 주세요. 그러면 생각별 아이콘을 눌러 앱처럼 열 수 있어요.';
    else if (isAndroid) msg.textContent = '안드로이드 Chrome에서 오른쪽 위 ⋮ → 앱 설치 또는 홈 화면에 추가 → 설치를 선택해 주세요.';
    else msg.textContent = '브라우저 주소창의 앱 설치 아이콘 또는 메뉴에서 설치를 선택해 주세요.';
    $('#installModal').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#installCloseBtn').focus();
  }
  async function startAppInstall() {
    if (installPrompt && window.isSecureContext) {
      const prompt = installPrompt; installPrompt = null;
      prompt.prompt();
      try { await prompt.userChoice; } catch (_) { /* User may dismiss. */ }
    } else showInstallInstructions();
  }
  function initializePwa() {
    $('#installAppBtn').addEventListener('click', startAppInstall);
    $('#installCloseBtn').addEventListener('click', closeInstallDialog);
    $('#installModalCloseBtn').addEventListener('click', closeInstallDialog);
    $('#installModal').addEventListener('click', e => { if (e.target.id === 'installModal') closeInstallDialog(); });
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
    window.addEventListener('appinstalled', () => { installPrompt = null; $('#installAppBtn').hidden = true; showToast('생각별이 홈 화면에 설치되었어요! ✨'); });
    if (standalone()) $('#installAppBtn').hidden = true;
    window.addEventListener('online', toggleOfflineBanner);
    window.addEventListener('offline', toggleOfflineBanner);
    toggleOfflineBanner();
    if ('serviceWorker' in navigator && window.isSecureContext) {
      window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}), {once: true});
    }
  }
  async function initializeAccess() {
    try {
      const res = await fetch('/api/session', {cache:'no-store'});
      if (!res.ok) return;
      const s = await res.json();
      if (!s.locked || s.authenticated) return;
      $('#accessGate').hidden = false;
      document.body.style.overflow = 'hidden';
      $('#accessPin').focus();
    } catch (_) { /* Offline demo remains usable. */ }
  }
  function initializeAccessForm() {
    $('#accessForm').addEventListener('submit', async event => {
      event.preventDefault();
      const pin = $('#accessPin').value.trim();
      const error = $('#accessError');
      error.textContent = '';
      try {
        const res = await fetch('/api/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})});
        const data = await res.json();
        if (!res.ok) { error.textContent = data.error || '접근번호를 다시 확인해 주세요.'; return; }
        $('#accessPin').value = '';
        $('#accessGate').hidden = true;
        document.body.style.overflow = '';
        showToast('생각별에 오신 것을 환영해요! 🌷');
        refreshApiServerStatus();
      } catch (_) { error.textContent = '서버에 연결되지 않았어요. 네트워크를 확인해 주세요.'; }
    });
  }
  const EXAMPLES = {
    국어: ['주인공의 마음을 어떻게 알 수 있나요?', '글의 중심 생각은 어떻게 찾나요?'],
    수학: ['사과 12개를 3명에게 나누려면?', '7 × 6은 어떻게 생각해야 하나요?'],
    사회: ['우리 동네에 지도가 필요한 이유는?', '우리 주변의 공공기관은 무슨 일을 하나요?'],
    과학: ['얼음이 녹으면 무엇이 달라질까요?', '그림자는 왜 생기나요?'],
    영어: ['영어 문장에서 주어는 어떻게 찾나요?', '현재형과 과거형은 무엇이 달라요?']
  };

  // Installed-app convenience: save only non-secret preferences, never API/TTS keys.
  const savedPreferences = (() => {
    try { const v = JSON.parse(localStorage.getItem('thinkstar-prefs-v8') || '{}'); return v && typeof v === 'object' ? v : {}; }
    catch (_) { return {}; }
  })();
  const state = {
    grade: ['초1~2','초3~4','초5~6'].includes(savedPreferences.grade) ? savedPreferences.grade : '초3~4', subject: ['국어','수학','사회','과학','영어'].includes(savedPreferences.subject) ? savedPreferences.subject : '수학', mode: 'live', provider: savedPreferences.modeVersion === 11 && /^[a-z]+$/.test(savedPreferences.provider || '') ? savedPreferences.provider : 'gemini', model: savedPreferences.modeVersion === 11 && /^[a-zA-Z0-9_.:/+\-]{1,145}$/.test(savedPreferences.model || '') ? savedPreferences.model : 'gemini-3.8-flash', baseUrl: typeof savedPreferences.baseUrl === 'string' ? savedPreferences.baseUrl.slice(0,300) : '',
    active: null, hintLevel: 0, answerShown: false, photo: null, busy: false,
    messages: [], records: readRecords(), toastTimer: null
  };

  // Browser Web Speech API: no paid API required. Microphone recognition may use
  // the browser vendor's online recognition service (not guaranteed offline).
  const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
  const voiceSupported = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance === 'function';
  const voice = {
    autoRead: savedPreferences.autoRead !== false, recognition: null, listening: false, baseText: '',
    finalText: '', heardAnything: false, error: '',
    utterance: null, speakingButton: null, completedText: '', currentInterim: '',
    mode: savedPreferences.voiceMode === 'gemini' ? 'gemini' : 'browser', preferredVoice: typeof savedPreferences.preferredVoice === 'string' ? savedPreferences.preferredVoice : 'auto', geminiVoice: ['Zephyr','Callirrhoe','Aoede'].includes(savedPreferences.geminiVoice) ? savedPreferences.geminiVoice : 'Zephyr',
    availableVoices: [], audio: null, audioUrl: null, audioRequest: null, playToken: 0,
    startedAt: 0, lastSpeechAt: 0, silenceTimer: null, restartTimer: null, restartCount: 0
  };
  function savePreferences() {
    try {
      localStorage.setItem('thinkstar-prefs-v8', JSON.stringify({
        grade: state.grade, subject: state.subject, mode: state.mode, modeVersion: 11,
        provider: state.provider, model: state.model, baseUrl: state.baseUrl,
        autoRead: voice.autoRead, voiceMode: voice.mode,
        preferredVoice: voice.preferredVoice, geminiVoice: voice.geminiVoice,
        rate: Number($('#speechRateSelect')?.value) || 0.92
      }));
    } catch (_) { /* Storage disabled; use session only. */ }
  }
  function voiceNotice(text, type = '') {
    const el = $('#voiceFeedback');
    el.className = `voice-feedback${type ? ` is-${type}` : ''}`;
    el.textContent = text;
  }
  function updateMicrophoneUi() {
    const button = $('#micBtn');
    button.disabled = state.busy || !SpeechRecognitionClass;
    button.classList.toggle('is-listening', voice.listening);
    button.setAttribute('aria-pressed', String(voice.listening));
    button.setAttribute('aria-label', voice.listening ? '음성 인식 끝내기' : '음성으로 질문하기');
    $('#micLabel').textContent = voice.listening ? '듣기 끝내기' : '말로 질문';
  }
  // Keep a listening session alive while the learner speaks or pauses briefly.
  // Chromium may end one recognition instance early, so restart it within the
  // grace window. SpeechRecognition has no portable silence-timeout setting.
  const SILENCE_GRACE_MS = 5500; // >3 extra seconds of silence after speech
  const FIRST_SPEECH_WAIT_MS = 15000;
  function stopListening({ announce = false } = {}) {
    const recognition = voice.recognition;
    voice.recognition = null;
    voice.listening = false;
    clearTimeout(voice.silenceTimer);
    clearTimeout(voice.restartTimer);
    voice.silenceTimer = null;
    voice.restartTimer = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try { recognition.stop(); } catch (_) { /* already ended */ }
    }
    updateMicrophoneUi();
    if (announce) {
      voiceNotice(voice.error || (voice.heardAnything
        ? '✅ 음성 질문이 글자로 바뀌었어요. 내용을 확인하고 보내기를 눌러 주세요.'
        : '아직 목소리를 인식하지 못했어요. 마이크를 눌러 다시 말해 주세요.'),
      voice.error || !voice.heardAnything ? 'error' : 'success');
      $('#messageInput').focus();
    }
  }
  function scheduleRecognitionEnd() {
    clearTimeout(voice.silenceTimer);
    if (!voice.listening) return;
    const last = voice.lastSpeechAt || voice.startedAt;
    const wait = (voice.lastSpeechAt ? SILENCE_GRACE_MS : FIRST_SPEECH_WAIT_MS) - (Date.now() - last);
    voice.silenceTimer = setTimeout(() => stopListening({ announce: true }), Math.max(100, wait));
  }
  function updateReplayButtons() {
    document.querySelectorAll('.audio-replay-button').forEach((button) => {
      const speaking = button === voice.speakingButton;
      button.classList.toggle('is-speaking', speaking);
      button.textContent = speaking ? '⏹ 읽기 멈추기' : '🔊 다시 듣기';
      button.setAttribute('aria-label', speaking ? '선생님 답변 읽기 중지' : '선생님 답변 음성으로 다시 듣기');
    });
  }
  function stopSpeaking() {
    voice.playToken += 1;
    if (voice.audioRequest) { voice.audioRequest.abort(); voice.audioRequest = null; }
    if (voice.audio) { voice.audio.pause(); voice.audio.src = ''; voice.audio = null; }
    if (voice.audioUrl) { URL.revokeObjectURL(voice.audioUrl); voice.audioUrl = null; }
    voice.utterance = null;
    voice.speakingButton = null;
    if (voiceSupported) window.speechSynthesis.cancel();
    updateReplayButtons();
  }
  function preferredVoiceScore(item) {
    const name = `${item.name} ${item.voiceURI || ''}`.toLowerCase();
    if (!/^ko(?:-|_)/i.test(item.lang || '')) return -1e3;
    let score = 0;
    if (/sunhi|sun-hi|선희|hayoung|ha-young|하영|yuna|유나|jimin|지민|서현|sohyun|sora|소라|heami|혜미|hyuna|현아/.test(name)) score += 150;
    if (/natural|neural|online/.test(name)) score += 85;
    if (/female|woman|여성/.test(name)) score += 55;
    if (/google 한국어|google korean/.test(name)) score += 10;
    if (/male|man|남성|injoon|인준/.test(name)) score -= 175;
    return score;
  }
  function refreshBrowserVoices() {
    if (!voiceSupported) return;
    const available = window.speechSynthesis.getVoices().filter((item) => /^ko(?:-|_)/i.test(item.lang || ''));
    voice.availableVoices = available.sort((a, b) => preferredVoiceScore(b) - preferredVoiceScore(a));
    const select = $('#teacherVoiceSelect');
    const current = voice.preferredVoice;
    select.replaceChildren();
    const auto = document.createElement('option');
    auto.value = 'auto'; auto.textContent = '🌷 가장 부드러운 한국어 목소리 자동 선택';
    select.appendChild(auto);
    voice.availableVoices.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.voiceURI;
      option.textContent = `${/natural|neural/i.test(item.name) ? '✨ ' : ''}${item.name}`;
      select.appendChild(option);
    });
    select.value = current === 'auto' || voice.availableVoices.some((item) => item.voiceURI === current) ? current : 'auto';
    if (!voice.availableVoices.length) {
      $('#teacherVoiceInfo').textContent = '이 브라우저에서 한국어 목소리를 찾지 못했어요. Windows에서는 Microsoft Edge에서 다시 확인해 주세요.';
    } else if (voice.mode === 'browser') {
      const candidate = voice.availableVoices[0];
      $('#teacherVoiceInfo').textContent = `현재 추천: ${candidate.name} · 실제 여성 목소리와 자연스러움은 PC에 설치된 음성에 따라 달라요. 마음에 안 들면 목록에서 바꿔 보세요.`;
    }
  }
  function chosenBrowserVoice() {
    if (voice.preferredVoice !== 'auto') {
      const chosen = voice.availableVoices.find((item) => item.voiceURI === voice.preferredVoice);
      if (chosen) return chosen;
    }
    return voice.availableVoices[0] || null;
  }
  function setVoiceMode(mode) {
    stopSpeaking();
    voice.mode = mode === 'gemini' ? 'gemini' : 'browser';
    $('#teacherVoiceMode').value = voice.mode;
    $('#browserVoiceRow').hidden = voice.mode !== 'browser';
    $('#teacherSpeechRateRow').hidden = voice.mode !== 'browser';
    $('#geminiVoiceRow').hidden = voice.mode !== 'gemini';
        if (voice.mode === 'gemini') {
      $('#teacherVoiceInfo').textContent = 'Gemini 3.8 Flash-Lite TTS는 별도 음성 생성 API입니다. 무료 구간이 없을 수 있으며 요금/사용량이 발생합니다. Gemini 키는 Render 서버의 환경변수 GEMINI_API_KEY에서만 관리해요. 아이의 답변 문장이 Google로 전송됩니다.';
    } else {
      refreshBrowserVoices();
    }
    savePreferences();
  }
  function browserSpeak(message, button, token) {
    if (!voiceSupported) { showToast('이 브라우저에서 음성 읽기를 지원하지 않아요. Edge 또는 Chrome을 이용해 주세요.'); return; }
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = 'ko-KR';
    utterance.rate = Number($('#speechRateSelect').value) || 0.92;
    utterance.pitch = 1.06;
    utterance.volume = 1;
    const koreanVoice = chosenBrowserVoice();
    if (koreanVoice) utterance.voice = koreanVoice;
    voice.utterance = utterance;
    voice.speakingButton = button;
    updateReplayButtons();
    const finish = () => {
      if (voice.playToken === token) {
        voice.utterance = null; voice.speakingButton = null; updateReplayButtons();
      }
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    try { window.speechSynthesis.speak(utterance); }
    catch (_) { finish(); showToast('음성을 재생하지 못했어요. 스피커를 확인해 주세요.'); }
  }
  async function geminiSpeak(message, button, token) {
        voice.speakingButton = button;
    updateReplayButtons();
    // When hosted, GEMINI_API_KEY can be configured securely on the backend.
    // The server returns a clear error when neither server nor session key exists.
    const controller = new AbortController();
    voice.audioRequest = controller;
    if (button) button.textContent = '⏳ 목소리 만드는 중…';
    try {
      const response = await fetch('/api/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message.slice(0, 550), voiceName: voice.geminiVoice }),
        signal: controller.signal
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || `Gemini 음성 API 오류 (HTTP ${response.status})`);
      }
      const blob = await response.blob();
      if (voice.playToken !== token) return;
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      voice.audioUrl = audioUrl;
      voice.audio = audio;
      const finish = () => {
        if (voice.playToken === token) {
          voice.audio = null;
          voice.speakingButton = null;
          URL.revokeObjectURL(audioUrl);
          voice.audioUrl = null;
          updateReplayButtons();
        }
      };
      audio.addEventListener('ended', finish, { once: true });
      audio.addEventListener('error', finish, { once: true });
      await audio.play();
    } catch (error) {
      if (voice.playToken !== token || error.name === 'AbortError') return;
      showToast(error?.message || 'Gemini 목소리를 만들지 못했어요. 무료 음성 모드로 변경해 보세요.');
      voice.speakingButton = null;
      updateReplayButtons();
    } finally {
      if (voice.audioRequest === controller) voice.audioRequest = null;
    }
  }
  function speakTeacher(message, button = null) {
    const sentence = String(message || '').replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').trim();
    if (!sentence) return;
    if (button && button === voice.speakingButton && (voice.utterance || voice.audio || voice.audioRequest)) {
      stopSpeaking(); return;
    }
    stopSpeaking();
    const token = voice.playToken;
    if (voice.mode === 'gemini') geminiSpeak(sentence, button, token);
    else browserSpeak(sentence, button, token);
  }
  function beginRecognitionSegment() {
    if (!voice.listening) return;
    let recognition;
    try { recognition = new SpeechRecognitionClass(); }
    catch (_) { voice.error = '마이크를 시작하지 못했어요. 크롬이나 엣지에서 다시 시도해 주세요.'; stopListening({ announce: true }); return; }
    recognition.lang = 'ko-KR';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;
    voice.recognition = recognition;
    voice.currentInterim = '';
    recognition.onresult = (event) => {
      if (voice.recognition !== recognition || !voice.listening) return;
      let segmentFinal = '', segmentInterim = '';
      for (const result of event.results) {
        const piece = result[0]?.transcript?.trim() || '';
        if (result.isFinal) segmentFinal += `${piece} `;
        else segmentInterim += `${piece} `;
      }
      voice.finalText = [voice.completedText, segmentFinal.trim()].filter(Boolean).join(' ');
      voice.currentInterim = segmentInterim.trim();
      if (voice.finalText || voice.currentInterim) {
        voice.heardAnything = true;
        voice.lastSpeechAt = Date.now();
        scheduleRecognitionEnd();
      }
      $('#messageInput').value = [voice.baseText, voice.finalText, voice.currentInterim].filter(Boolean).join(' ').slice(0, 1600);
      voiceNotice('🎤 듣고 있어요. 잠깐 쉬어도 괜찮아요! 말을 멈춘 뒤 약 5.5초 후 마무리해요.', 'listening');
    };
    recognition.onerror = (event) => {
      if (voice.recognition !== recognition || !voice.listening) return;
      if (event.error === 'no-speech' || event.error === 'aborted') return; // restart until grace expires
      const messages = {
        'not-allowed': '마이크 사용 권한이 차단되었어요. 주소창 왼쪽에서 마이크를 허용해 주세요.',
        'service-not-allowed': '브라우저의 음성 인식 서비스가 차단되었어요.',
        'audio-capture': '마이크를 찾지 못했어요. 윈도우 마이크 설정을 확인해 주세요.',
        'network': '브라우저 음성 인식 서비스에 연결되지 않았어요. 인터넷을 확인해 주세요.',
        'language-not-supported': '한국어 음성 인식을 지원하지 않는 환경이에요.'
      };
      voice.error = messages[event.error] || '음성 인식 도중 문제가 발생했어요. 다시 시도해 주세요.';
      stopListening({ announce: true });
    };
    recognition.onend = () => {
      if (voice.recognition !== recognition || !voice.listening) return;
      // Preserve finalized words across short-lived browser recognition instances.
      // A final result sometimes never arrives before onend: keep partial text.
      voice.completedText = [voice.finalText, voice.currentInterim].filter(Boolean).join(' ').trim();
      voice.finalText = voice.completedText;
      voice.currentInterim = '';
      $('#messageInput').value = [voice.baseText, voice.completedText].filter(Boolean).join(' ').slice(0, 1600);
      voice.recognition = null;
      const expired = Date.now() - (voice.lastSpeechAt || voice.startedAt) >=
        (voice.lastSpeechAt ? SILENCE_GRACE_MS : FIRST_SPEECH_WAIT_MS);
      if (expired || voice.restartCount >= 40) { stopListening({ announce: true }); return; }
      voice.restartCount += 1;
      clearTimeout(voice.restartTimer);
      voice.restartTimer = setTimeout(beginRecognitionSegment, 180);
    };
    try { recognition.start(); }
    catch (_) {
      voice.error = '마이크를 시작할 수 없어요. 브라우저 권한을 확인해 주세요.';
      stopListening({ announce: true });
    }
  }
  function toggleMicrophone() {
    if (!SpeechRecognitionClass) {
      voiceNotice('이 브라우저는 음성 인식을 지원하지 않아요. 최신 크롬 또는 엣지에서 열어 주세요.', 'error');
      return;
    }
    if (voice.listening) { stopListening({ announce: true }); return; }
    if (state.busy) return;
    stopSpeaking(); // Prevent the teacher's voice from being transcribed.
    voice.listening = true;
    voice.baseText = $('#messageInput').value.trim();
    voice.finalText = '';
    voice.completedText = '';
    voice.currentInterim = '';
    voice.heardAnything = false;
    voice.error = '';
    voice.startedAt = Date.now();
    voice.lastSpeechAt = 0;
    voice.restartCount = 0;
    updateMicrophoneUi();
    voiceNotice('🔴 듣고 있어요! 처음 말을 시작할 때는 15초까지 기다리고, 말하는 중에는 5.5초 쉬어도 괜찮아요.', 'listening');
    scheduleRecognitionEnd();
    beginRecognitionSegment();
  }
  function initVoice() {
    $('#micBtn').addEventListener('click', toggleMicrophone);
    $('#autoSpeakBtn').addEventListener('click', () => {
      voice.autoRead = !voice.autoRead;
      $('#autoSpeakBtn').setAttribute('aria-pressed', String(voice.autoRead));
      $('#autoSpeakBtn').textContent = voice.autoRead ? '🔊 자동 읽기 켜짐' : '🔇 자동 읽기 꺼짐';
      if (!voice.autoRead) stopSpeaking();
      savePreferences();
      showToast(voice.autoRead ? '선생님이 힌트를 자동으로 읽어 줄게요!' : '이제 버튼을 누를 때만 소리 내어 읽어요.');
    });
    if (!SpeechRecognitionClass) {
      voiceNotice('이 브라우저에서는 말로 질문하기를 지원하지 않아요. 최신 크롬 또는 엣지에서 열어 주세요.', 'error');
      $('#micBtn').title = '현재 브라우저에서는 음성 인식이 지원되지 않습니다';
    }
    $('#openVoiceSettingsBtn').addEventListener('click', () => {
      openModal('voiceModal');
      refreshBrowserVoices();
    });
    $('#teacherVoiceMode').addEventListener('change', (event) => setVoiceMode(event.target.value));
    $('#teacherVoiceSelect').addEventListener('change', (event) => { voice.preferredVoice = event.target.value; stopSpeaking(); savePreferences(); });
    $('#geminiVoiceSelect').addEventListener('change', (event) => { voice.geminiVoice = event.target.value; stopSpeaking(); savePreferences(); });
    $('#voicePreviewBtn').addEventListener('click', () => speakTeacher('안녕하세요! 저는 생각별 선생님이에요. 우리 오늘도 천천히, 즐겁게 공부해 볼까요?', null));
    $('#voiceStopBtn').addEventListener('click', stopSpeaking);
    $('#speechRateSelect').addEventListener('change', () => { stopSpeaking(); savePreferences(); });
    const savedRate = Number(savedPreferences.rate);
    if ([0.82, 0.92, 1.02, 1.12].includes(savedRate)) $('#speechRateSelect').value = String(savedRate);
    $('#autoSpeakBtn').setAttribute('aria-pressed', String(voice.autoRead));
    $('#autoSpeakBtn').textContent = voice.autoRead ? '🔊 자동 읽기 켜짐' : '🔇 자동 읽기 꺼짐';
    $('#geminiVoiceSelect').value = voice.geminiVoice;
    setVoiceMode(voice.mode);
    if (voiceSupported) {
      window.speechSynthesis.addEventListener?.('voiceschanged', refreshBrowserVoices);
      refreshBrowserVoices();
    } else {
      $('#teacherVoiceInfo').textContent = '브라우저 기본 목소리를 찾지 못했어요. Gemini 음성 API를 사용하거나 Edge 브라우저에서 열어 주세요.';
    }
    updateMicrophoneUi();
  }

  function readRecords() {
    try {
      const raw = localStorage.getItem('thinkstar-report-v1') || sessionStorage.getItem('thinkstar-report-v1');
      const result = JSON.parse(raw || '[]');
      return Array.isArray(result) ? result.filter((r) => r && r.day === nowDay()).slice(-60) : [];
    } catch (_) { return []; }
  }
  function saveRecords() {
    try { localStorage.setItem('thinkstar-report-v1', JSON.stringify(state.records.slice(-60))); }
    catch (_) { /* Private browsing may disable sessionStorage. */ }
  }
  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
  }
  function updateSelectors() {
    document.querySelectorAll('[data-grade]').forEach((button) => {
      const active = button.dataset.grade === state.grade;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('[data-subject]').forEach((button) => {
      const active = button.dataset.subject === state.subject;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('#currentClass').textContent = `${state.grade} · ${state.subject}`;
    renderSamples();
  }
  function renderSamples() {
    const wrap = $('#samplePrompts');
    wrap.replaceChildren();
    EXAMPLES[state.subject].forEach((example) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sample-prompt';
      b.textContent = `✦ ${example}`;
      b.addEventListener('click', () => sendMessage(example));
      wrap.appendChild(b);
    });
  }
  function changeCourse(nextGrade, nextSubject) {
    if (state.busy) { showToast('선생님이 힌트를 생각하고 있어요. 잠깐 후에 바꿔주세요.'); return; }
    if (state.grade === nextGrade && state.subject === nextSubject) return;
    state.grade = nextGrade;
    state.subject = nextSubject;
    savePreferences();
    resetConversation();
    updateSelectors();
    showToast(`${state.grade} ${SUBJECT_EMOJI[state.subject]} ${state.subject} 공부를 시작해요!`);
  }
  function updateProgress() {
    const stars = $('#starTrack');
    stars.textContent = state.hintLevel === 0 ? '✦' : '⭐'.repeat(Math.min(state.hintLevel, 5)) + (state.hintLevel > 5 ? ' +' : '');
    stars.setAttribute('aria-label', `지금까지 힌트 ${state.hintLevel}회, 횟수 제한 없음`);
    $('#progressCounter').textContent = `${state.hintLevel}회 · 무제한`;
    $('#moreHintBtn').disabled = !state.active || state.busy;
    const canReveal=Boolean(state.active && state.hintLevel >= 5 && !state.busy && !state.answerShown);
    const reveal=$('#revealAnswerBtn');
    reveal.disabled=!canReveal;
    reveal.classList.toggle('is-unlocked',canReveal);
    reveal.textContent=state.answerShown ? '✅ 정답 확인 완료' : canReveal ? '🔓 정답 보기 (비밀번호 필요)' : `🔒 정답 보기 (${Math.min(state.hintLevel,5)}/5)`;
    $('#recheckProblemBtn').disabled = !state.active || state.busy;
    $('#understoodBtn').disabled = !state.active || state.busy;
    $('#sendBtn').disabled = state.busy;
    $('#messageInput').disabled = state.busy;
    $('#photoInput').disabled = state.busy;
    $('#newProblemBtn').disabled = state.busy;
    updateMicrophoneUi();
    document.querySelectorAll('.sample-prompt').forEach((btn) => { btn.disabled = state.busy; });
  }
  function resetConversation() {
    stopListening();
    stopSpeaking();
    voiceNotice('🎤 마이크를 누르면 질문을 글자로 바꿀 수 있어요.');
    state.active = null;
    state.messages = [];
    state.hintLevel = 0;
    state.answerShown = false;
    clearPhoto();
    $('#messageInput').value = '';
    $('#chatBody').replaceChildren($('#welcomeCard'));
    $('#welcomeCard').hidden = false;
    updateProgress();
  }
  function addMessage(role, message, { photo = false, loading = false, focus = '' } = {}) {
    $('#welcomeCard').hidden = true;
    const box = document.createElement('div');
    box.className = `chat-message ${role}`;
    if (role === 'teacher') {
      const avatar = document.createElement('div');
      avatar.className = 'message-avatar';
      avatar.textContent = '🌟';
      avatar.setAttribute('aria-hidden', 'true');
      box.appendChild(avatar);
    }
    const content = document.createElement('div');
    content.className = 'message-content';
    if (role === 'teacher') {
      const meta = document.createElement('div');
      meta.className = 'message-meta'; meta.textContent = '생각별 선생님';
      content.appendChild(meta);
    }
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    if (loading) {
      const waiting = document.createElement('div');
      waiting.className = 'thinking'; waiting.setAttribute('aria-label', '힌트를 생각하고 있어요');
      for (let i = 0; i < 3; i++) waiting.appendChild(document.createElement('span'));
      bubble.appendChild(waiting);
    } else {
      if (photo) {
        const p = document.createElement('span'); p.className = 'photo-tag'; p.textContent = '📷 문제 사진 첨부';
        bubble.appendChild(p);
      }
      if (message) bubble.appendChild(document.createTextNode(message));
    }
    content.appendChild(bubble);
    if (role === 'teacher' && !loading && focus) {
      const understanding = document.createElement('div');
      understanding.className = 'problem-understanding';
      understanding.textContent = `🔎 문제 이해: ${focus.slice(0, 135)}`;
      content.appendChild(understanding);
    }
    if (role === 'teacher' && !loading && message && voiceSupported) {
      const replay = document.createElement('button');
      replay.type = 'button';
      replay.className = 'audio-replay-button';
      replay.textContent = '🔊 다시 듣기';
      replay.setAttribute('aria-label', '선생님 답변 음성으로 다시 듣기');
      replay.addEventListener('click', () => speakTeacher(message, replay));
      content.appendChild(replay);
    }
    if (!loading) {
      const time = document.createElement('div');
      time.className = 'message-time';
      time.textContent = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      content.appendChild(time);
    }
    box.appendChild(content);
    $('#chatBody').appendChild(box);
    $('#chatBody').scrollTop = $('#chatBody').scrollHeight;
    return box;
  }
  function makeProblem(question, photo) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    state.active = { id, question, hadPhoto: photo, photoDataUrl: null };
    state.hintLevel = 0;
    state.answerShown = false;
    state.messages = [];
    state.records.push({ id, day: nowDay(), time: new Date().toISOString(), grade: state.grade, subject: state.subject, question: question || '사진으로 올린 문제', hints: 0, understood: false, solved: false, revealed: false });
    saveRecords();
  }
  function updateRecord(changes) {
    if (!state.active) return;
    const record = state.records.find((r) => r.id === state.active.id);
    if (!record) return;
    Object.assign(record, changes);
    saveRecords();
  }
  const PROVIDER_SETTINGS = {
    gemini: { label: 'Google Gemini', model: 'gemini-3.8-flash', guide: 'Google AI Studio에서 Gemini API 키 발급 · <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">키 발급 페이지</a> · 정확도 우선 추천: gemini-3.8-flash · 무료 한도는 계정마다 다릅니다.' },
    openai: { label: 'OpenAI', model: 'gpt-4.1-mini', guide: '<a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI API 키 발급</a> · 별도 API 비용이 발생할 수 있어요.' },
    anthropic: { label: 'Anthropic Claude', model: 'claude-sonnet-4-5', guide: '<a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">Claude API 키 발급</a> · 계정별 요금이 적용돼요.' },
    openrouter: { label: 'OpenRouter', model: 'google/gemini-2.5-flash', guide: '<a href="https://openrouter.ai/settings/keys" target="_blank" rel="noopener noreferrer">OpenRouter API 키 발급</a> · 모델 이름과 요금/무료 표시를 확인하세요.' },
    groq: { label: 'Groq', model: 'llama-3.3-70b-versatile', guide: '<a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">Groq API 키 발급</a> · 이용 한도는 모델에 따라 달라요.' },
    deepseek: { label: 'DeepSeek', model: 'deepseek-chat', guide: '<a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener noreferrer">DeepSeek API 키 발급</a>' },
    mistral: { label: 'Mistral AI', model: 'mistral-small-latest', guide: '<a href="https://console.mistral.ai/" target="_blank" rel="noopener noreferrer">Mistral AI Console</a>' },
    together: { label: 'Together AI', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', guide: '<a href="https://api.together.ai/settings/api-keys" target="_blank" rel="noopener noreferrer">Together AI API 키 발급</a>' },
    xai: { label: 'xAI', model: 'grok-4', guide: '<a href="https://console.x.ai/" target="_blank" rel="noopener noreferrer">xAI Console</a>' },
    custom: { label: '사용자 지정 API', model: '', guide: 'OpenAI Chat Completions 호환 API만 지원합니다. 신뢰할 수 있는 제공업체의 HTTPS 주소만 입력하세요.' }
  };
  async function refreshApiServerStatus() {
    const el = $('#serverKeyStatus');
    if (!el) return;
    const provider = $('#apiProviderSelect').value;
    el.textContent = '서버에 등록된 API 키 상태를 확인하고 있어요…';
    try {
      const response = await fetch('/api/provider-config', { cache: 'no-store' });
      if (!response.ok) {
        el.textContent = response.status === 401 ? '먼저 생각별 접속번호로 로그인해 주세요.' : '서버 설정을 확인할 수 없어요.';
        return;
      }
      const data = await response.json();
      const item = data.providers?.[provider];
      if (!item) { el.textContent = '선택한 AI 제공업체 정보를 확인할 수 없어요.'; return; }
      el.textContent = item.configured
        ? `✅ ${item.label} API 키가 서버에 등록되어 있어요. 앱에 키를 넣을 필요가 없어요.`
        : `⚠️ ${item.label} API 키가 서버에 없어요. Render → Environment에서 ${item.env}를 등록해 주세요.`;
    } catch (_) {
      el.textContent = '서버 연결 상태를 확인하지 못했어요. 인터넷을 확인해 주세요.';
    }
  }
  function syncProviderFields({ switched = false } = {}) {
    const mode = document.querySelector('input[name="mode"]:checked')?.value || 'live';
    $('#apiProviderFields').hidden = mode !== 'live';
    if (mode !== 'live') return;
    const provider = $('#apiProviderSelect').value;
    const config = PROVIDER_SETTINGS[provider];
    $('#providerGuide').innerHTML = config.guide; // Only static, developer-authored markup.
    $('#customApiRow').hidden = provider !== 'custom';
    if (switched) { $('#apiModelInput').value = config.model; }
    refreshApiServerStatus();
    $('#apiConnectionStatus').textContent = '';
    delete $('#apiConnectionStatus').dataset.result;
  }
  async function getLiveHint(photoDataUrl, attemptText = '', recheck = false) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 95000);
    try {
      const response = await fetch('/api/tutor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: state.provider, model: state.model, baseUrl: state.provider === 'custom' ? state.baseUrl : '', grade: state.grade, subject: state.subject, hintLevel: state.hintLevel, problemId: state.active?.id || '', attemptText, recheck, problem: state.active?.question || '', messages: state.messages.slice(-12), imageDataUrl: photoDataUrl || null }),
        signal: controller.signal
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `API 서버 오류 (${response.status})`);
      if (typeof result.hint !== 'string' || !result.hint.trim()) throw new Error('AI 힌트를 읽을 수 없어요.');
      return { hint: result.hint.trim(), problemFocus: typeof result.problemFocus === 'string' ? result.problemFocus.slice(0,140) : '', verdict: result.verdict === 'correct' ? 'correct' : result.verdict === 'incorrect' ? 'incorrect' : 'uncertain', hintCount: Number.isInteger(result.hintCount) ? result.hintCount : state.hintLevel };
    } finally { clearTimeout(timeout); }
  }
  async function sendMessage(text, { fromHintButton = false, fromRecheck = false } = {}) {
    if (state.busy) return;
    const typed = (text || '').trim().slice(0, 1600);
    if (voice.listening) stopListening();
    stopSpeaking();
    const uploadedImage = state.photo ? state.photo.dataUrl : null;
    if (!typed && !uploadedImage) { showToast('질문을 적거나 사진을 올려 주세요!'); return; }
    const isNew = !state.active;
    if (isNew) makeProblem(typed, !!uploadedImage);
    if (uploadedImage && state.active) state.active.photoDataUrl = uploadedImage; // kept only in memory for next hints
    if (!isNew && uploadedImage && typed && state.active.question === '사진으로 올린 문제') {
      updateRecord({ question: typed });
      state.active.question = typed;
    }
    state.hintLevel += 1;
    const studentText = fromRecheck ? '처음 문제의 숫자와 조건, 무엇을 구하는지를 다시 확인하고 앞의 힌트를 고쳐 주세요.' : fromHintButton ? '힌트를 하나 더 주세요.' : typed;
    state.messages.push({ role: 'user', content: studentText || '첨부한 사진 속 문제를 풀기 위한 힌트를 주세요.' });
    addMessage('student', fromRecheck ? '문제를 다시 읽어 주세요! 🔎' : fromHintButton ? '힌트 더 주세요! 💡' : typed, { photo: !!uploadedImage });
    $('#messageInput').value = '';
    clearPhoto();
    state.busy = true;
    updateProgress();
    const pending = addMessage('teacher', '', { loading: true });
    try {
      const attemptText = !isNew && !fromHintButton && !fromRecheck && typed ? typed : '';
      const reply = await getLiveHint(uploadedImage || state.active?.photoDataUrl || null, attemptText, fromRecheck);
      state.hintLevel = reply.hintCount;
      pending.remove();
      addMessage('teacher', reply.hint, { focus: reply.problemFocus });
      if (voice.autoRead) speakTeacher(reply.hint);
      state.messages.push({ role: 'assistant', content: reply.hint });
      if (reply.verdict === 'correct') {
        updateRecord({ solved: true });
        state.active = null;
        state.messages = [];
        showToast('🎉 스스로 문제를 맞혔어요! 새로운 문제도 풀어 볼까요?');
      } else {
        updateRecord({ hints: state.hintLevel });
      }
    } catch (error) {
      pending.remove();
      state.hintLevel = Math.max(0, state.hintLevel - 1);
      state.messages.pop();
      if (isNew) {
        const failedId = state.active?.id;
        state.records = state.records.filter(r => r.id !== failedId);
        saveRecords();
        state.active = null; state.messages = []; state.hintLevel = 0;
        if (typed) $('#messageInput').value = typed;
      }
      addMessage('teacher', '정확하지 않은 힌트는 보여주지 않을게요. 🌷 AI 연결 상태나 문제 원문을 확인한 뒤 다시 시도해 주세요.');
      showToast(error.name === 'AbortError' ? '연결 시간이 오래 걸리고 있어요.' : error.message);
    } finally {
      state.busy = false;
      updateProgress();
      $('#messageInput').focus();
    }
  }
  function markUnderstood() {
    if (!state.active || state.busy) return;
    updateRecord({ understood: true });
    addMessage('student', '이해했어요! 🌟');
    const encouragement = '와, 스스로 생각해 봤군요! 정말 멋져요! 🎉 다음 문제도 도전해 볼까요?';
    addMessage('teacher', encouragement);
    if (voice.autoRead && !voice.listening) speakTeacher(encouragement);
    state.active = null; state.messages = [];
    updateProgress();
    showToast('오늘의 공부 기록에 반짝 별이 추가됐어요! ✨');
  }
  async function prepareImage(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { showToast('JPG, PNG, WEBP 사진만 올릴 수 있어요.'); return; }
    if (file.size > 12 * 1024 * 1024) { showToast('12MB보다 작은 사진을 골라 주세요.'); return; }
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const dataUrl = canvas.toDataURL('image/jpeg', .82);
      if (dataUrl.length > 4 * 1024 * 1024) { showToast('사진 용량이 너무 커요. 다른 사진을 사용해 주세요.'); return; }
      state.photo = { dataUrl };
      $('#photoThumbnail').src = dataUrl;
      $('#photoPreview').hidden = false;
      showToast(state.mode === 'demo' ? '사진을 첨부했어요! 데모에서는 사진의 글자를 읽지 못해요.' : '사진을 첨부했어요! AI가 문제를 살펴볼 수 있어요.');
    } catch (_) { showToast('사진을 열 수 없어요. 다른 파일을 골라 주세요.'); }
    finally { $('#photoInput').value = ''; }
  }
  function clearPhoto() {
    state.photo = null;
    $('#photoThumbnail').removeAttribute('src');
    $('#photoPreview').hidden = true;
    $('#photoInput').value = '';
  }
  function openModal(id) {
    const modal = $(`#${id}`);
    modal.hidden = false;
    if (id === 'settingsModal') {
      $(`input[name="mode"][value="${state.mode}"]`).checked = true;
      $('#apiProviderSelect').value = state.provider;
      $('#apiModelInput').value = state.model;
      $('#apiBaseUrlInput').value = state.baseUrl;
      syncProviderFields();
      $('#settingStatus').textContent = '';
      $('#oldAnswerPin').value = '';
      $('#newAnswerPin').value = '';
      $('#newAnswerPinConfirm').value = '';
      $('#changeAnswerPinStatus').textContent = '';
      refreshAnswerPinStatus();
    } else if (id === 'answerModal') {
      $('#revealPinInput').value = '';
      $('#revealAnswerStatus').textContent = '';
    } else if (id === 'parentModal') renderReport();
    document.body.style.overflow = 'hidden';
    (id === 'answerModal' ? $('#revealPinInput') : modal.querySelector('.close-modal')).focus();
  }
  function closeModal(id) {
    $(`#${id}`).hidden = true;
    document.body.style.overflow = '';
    (id === 'settingsModal' ? $('#settingsBtn') : id === 'voiceModal' ? $('#openVoiceSettingsBtn') : id === 'answerModal' ? $('#revealAnswerBtn') : $('#parentBtn')).focus();
  }
  function updateMode() {
    const onlineAI = true;
    $('#modeBadge').classList.toggle('live', onlineAI);
    $('#modeBadge').lastChild.textContent = ` ${PROVIDER_SETTINGS[state.provider]?.label || 'AI 분석'}`;
    $('#photoNote').textContent = '사진은 선택한 외부 AI 서비스에 문제를 분석·검토할 때 전송돼요.';
  }
  function saveSettings() {
    if (state.busy) { $('#settingStatus').textContent = '응답이 끝난 뒤 설정을 바꿀 수 있어요.'; return; }
    const mode = document.querySelector('input[name="mode"]:checked')?.value || 'live';
    const provider = $('#apiProviderSelect').value;
    const model = $('#apiModelInput').value.trim();
    const baseUrl = $('#apiBaseUrlInput').value.trim();
    if (mode === 'live' && !/^[a-zA-Z0-9_.:/+\-]{1,145}$/.test(model)) {
      $('#settingStatus').textContent = 'AI 모델 이름을 입력해 주세요.'; return;
    }
    if (mode === 'live' && provider === 'custom' && !/^https:\/\/[^\s]+$/i.test(baseUrl)) {
      $('#settingStatus').textContent = '사용자 지정 기본 URL은 https://로 시작해야 해요.'; return;
    }
    if (state.mode !== mode || (mode === 'live' && (state.provider !== provider || state.model !== model))) resetConversation();
    state.mode = mode;
    state.provider = provider;
    state.model = model;
    state.baseUrl = baseUrl;
    savePreferences();
    updateMode(); closeModal('settingsModal');
    showToast(`${PROVIDER_SETTINGS[provider].label}을 선택했어요. AI 문제 분석과 힌트 검토를 진행해요.`);
  }
  async function testApiConnection() {
    const status = $('#apiConnectionStatus');
    const button = $('#testApiConnectionBtn');
    const mode = document.querySelector('input[name="mode"]:checked')?.value || 'live';
    const provider = $('#apiProviderSelect').value;
    const model = $('#apiModelInput').value.trim();
    const baseUrl = $('#apiBaseUrlInput').value.trim();
    if (mode !== 'live') { status.textContent = '먼저 외부 AI API 연결을 선택해 주세요.'; return; }
    // Key may be configured securely on the server for mobile HTTPS hosting.
    if (!/^[a-zA-Z0-9_.:/+\-]{1,145}$/.test(model)) { status.textContent = '유효한 모델명을 입력해 주세요.'; return; }
    if (provider === 'custom' && !/^https:\/\/[^\s]+$/i.test(baseUrl)) { status.textContent = 'HTTPS API 기본 주소를 입력하세요.'; return; }
    status.textContent = `⏳ ${PROVIDER_SETTINGS[provider]?.label || provider} 연결을 시험하고 있어요…`;
    status.dataset.result = 'testing';
    button.disabled = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);
    try {
      // Explicit user-triggered connection test, not part of saving a key.
      // Calls the actual provider; a tiny amount of quota may be used.
      const response = await fetch('/api/tutor', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, baseUrl: provider === 'custom' ? baseUrl : '',
          grade: '초3~4', subject: '수학', hintLevel: 1, problem: '7 × 6을 어떻게 생각해야 하나요?',
          messages: [{ role: 'user', content: '7 × 6을 계산할 때 힌트 하나를 알려 주세요.' }] }),
        signal: controller.signal
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `연결 오류 (HTTP ${response.status})`);
      if (!result.hint) throw new Error('연결했지만 AI가 글자 힌트를 반환하지 않았어요.');
      status.dataset.result = 'success';
      status.textContent = `✅ 연결 성공! ${provider} · ${model} 모델에서 학습 힌트를 받았어요. 이제 '설정 적용하기'를 누르세요.`;
    } catch (error) {
      status.dataset.result = 'error';
      status.textContent = error.name === 'AbortError' ? '연결 시험 시간이 초과되었어요. 인터넷 상태를 확인하세요.' : `❌ ${error.message}`;
    } finally {
      clearTimeout(timeoutId);
      button.disabled = false;
    }
  }

  async function refreshAnswerPinStatus() {
    try {
      const response=await fetch('/api/answer/config',{cache:'no-store'});
      const data=await response.json();
      if (!response.ok) throw Error(data.error || '설정을 불러오지 못했어요.');
      $('#answerPinScope').textContent=data.pinChanged
        ? '✅ 이 기기에서 변경한 비밀번호가 적용되어 있어요. 브라우저 데이터 삭제 시 초기 비밀번호로 돌아갈 수 있어요.'
        : '⚠️ 초기 비밀번호는 0000이에요. 다른 사람이 추측하기 쉬우므로 꼭 변경해 주세요. 비밀번호는 이 기기에만 적용돼요.';
    } catch (_) { $('#answerPinScope').textContent='정답 비밀번호 상태를 불러오지 못했어요.'; }
  }
  async function changeAnswerPin() {
    const button=$('#changeAnswerPinBtn'), status=$('#changeAnswerPinStatus');
    const oldPin=$('#oldAnswerPin').value.trim();
    const newPin=$('#newAnswerPin').value.trim();
    const checkPin=$('#newAnswerPinConfirm').value.trim();
    if (!/^\d{4,12}$/.test(newPin) || newPin==='0000') { status.textContent='새 비밀번호는 0000이 아닌 숫자 4~12자리로 입력해 주세요.'; return; }
    if (newPin!==checkPin) { status.textContent='새 비밀번호 두 개가 서로 달라요.'; return; }
    button.disabled=true; status.textContent='변경하고 있어요…';
    try {
      const response=await fetch('/api/answer/change-pin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({oldPin,newPin})});
      const data=await response.json();
      if (!response.ok) throw Error(data.error || '변경에 실패했어요.');
      status.textContent='✅ 새 비밀번호로 변경했어요. 이 기기에만 적용됩니다.';
      $('#oldAnswerPin').value='';$('#newAnswerPin').value='';$('#newAnswerPinConfirm').value='';
      refreshAnswerPinStatus();
    } catch (error) { status.textContent=`❌ ${error.message}`; }
    finally { button.disabled=false; }
  }
  async function revealAnswer() {
    if (!state.active || state.hintLevel<5 || state.answerShown || state.busy) return;
    const pin=$('#revealPinInput').value.trim(),status=$('#revealAnswerStatus'),button=$('#confirmRevealAnswerBtn');
    if (!/^\d{4,12}$/.test(pin)) { status.textContent='숫자 4~12자리 비밀번호를 입력해 주세요.'; return; }
    state.busy=true;button.disabled=true;status.textContent='🔎 AI가 정답을 두 번 확인하고 있어요…';updateProgress();
    try {
      const body={pin,problemId:state.active.id,problem:state.active.question,grade:state.grade,subject:state.subject,
        provider:state.provider,model:state.model,baseUrl:state.provider==='custom'?state.baseUrl:'',imageDataUrl:state.active.photoDataUrl};
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),110000);
      let response,data;
      try { response=await fetch('/api/answer/reveal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal}); data=await response.json().catch(()=>({})); }
      finally { clearTimeout(timeout); }
      if (!response.ok) throw Error(data.error || `서버 오류 (${response.status})`);
      if (typeof data.answer!=='string' || !data.answer.trim()) throw Error('AI 정답을 확인하지 못했어요.');
      const msg=`🔐 학부모 확인 후 공개한 정답: ${data.answer.trim()}${data.explanation?'\n\n풀이 설명: '+data.explanation:''}`;
      addMessage('teacher',msg);
      if (voice.autoRead) speakTeacher(msg);
      state.messages.push({role:'assistant',content:'보호자 확인 후 정답이 공개됐어요.'});
      state.answerShown=true;
      updateRecord({revealed:true});
      $('#revealPinInput').value='';
      closeModal('answerModal');showToast('🔐 보호자 확인 후 정답을 공개했어요.');
    } catch(error) { status.textContent=error.name==='AbortError'?'정답 확인 요청이 너무 오래 걸렸어요. 다시 시도해 주세요.':`❌ ${error.message}`; }
    finally {state.busy=false;button.disabled=false;updateProgress();}
  }
  function renderReport() {
    const todayRecords = state.records.filter((r) => r.day === nowDay());
    $('#reportDate').textContent = `${new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })} · 이 기기에서 공부한 내용`;
    $('#statProblems').firstChild.textContent = String(todayRecords.length);
    $('#statHints').firstChild.textContent = String(todayRecords.reduce((sum, r) => sum + (r.hints || 0), 0));
    $('#statSolved').firstChild.textContent = String(todayRecords.filter((r) => r.solved).length);
    $('#statUnderstood').firstChild.textContent = String(todayRecords.filter((r) => r.understood).length);
    const list = $('#reportList'); list.replaceChildren();
    if (!todayRecords.length) {
      const empty = document.createElement('div');
      empty.className = 'report-empty';
      empty.textContent = '아직 질문 기록이 없어요. 첫 질문을 시작해 볼까요? 🌼';
      list.appendChild(empty);
      return;
    }
    [...todayRecords].reverse().forEach((record) => {
      const wrapper = document.createElement('article'); wrapper.className = 'report-entry';
      const top = document.createElement('div'); top.className = 'report-entry-top';
      const date = document.createElement('span');
      date.textContent = `${record.grade} · ${SUBJECT_EMOJI[record.subject] || '📚'} ${record.subject} · ${new Date(record.time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} · 힌트 ${record.hints}회`;
      const status = document.createElement('strong');
      status.textContent = record.solved ? '✅ 스스로 정답' : record.revealed ? '🔓 보호자 정답 열람' : record.understood ? '🌟 이해 표시' : '💭 생각 중';
      status.className = record.solved || record.understood ? 'self-reported' : 'pending';
      top.append(date, status);
      const q = document.createElement('p');
      q.textContent = record.question.slice(0, 250);
      wrapper.append(top, q); list.appendChild(wrapper);
    });
  }

  document.querySelectorAll('[data-grade]').forEach((button) => button.addEventListener('click', () => changeCourse(button.dataset.grade, state.subject)));
  document.querySelectorAll('[data-subject]').forEach((button) => button.addEventListener('click', () => changeCourse(state.grade, button.dataset.subject)));
  initializePwa();
  initializeAccessForm();
  initializeAccess();
  $('#messageForm').addEventListener('submit', (event) => { event.preventDefault(); sendMessage($('#messageInput').value); });
  $('#messageInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); sendMessage($('#messageInput').value); }
  });
  $('#moreHintBtn').addEventListener('click', () => sendMessage('힌트를 하나 더 주세요.', { fromHintButton: true }));
  $('#revealAnswerBtn').addEventListener('click',()=>{if (state.active && state.hintLevel>=5 && !state.busy && !state.answerShown) openModal('answerModal');});
  $('#confirmRevealAnswerBtn').addEventListener('click',revealAnswer);
  $('#revealPinInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();revealAnswer();}});
  $('#changeAnswerPinBtn').addEventListener('click',changeAnswerPin);
  $('#recheckProblemBtn').addEventListener('click', () => sendMessage('문제를 다시 읽어 주세요.', { fromRecheck: true }));
  $('#understoodBtn').addEventListener('click', markUnderstood);
  $('#newProblemBtn').addEventListener('click', () => { if (!state.busy) { resetConversation(); $('#messageInput').focus(); } });
  $('#photoInput').addEventListener('change', (event) => prepareImage(event.target.files?.[0]));
  $('#removePhotoBtn').addEventListener('click', clearPhoto);
  document.querySelectorAll('input[name="mode"]').forEach((input) => input.addEventListener('change', () => syncProviderFields()));
  $('#apiProviderSelect').addEventListener('change', () => syncProviderFields({ switched: true }));
  $('#settingsBtn').addEventListener('click', () => openModal('settingsModal'));
  $('#parentBtn').addEventListener('click', () => openModal('parentModal'));
  $('#saveSettingsBtn').addEventListener('click', saveSettings);
  $('#testApiConnectionBtn').addEventListener('click', testApiConnection);
  $('#clearReportBtn').addEventListener('click', () => {
    if (window.confirm('오늘의 학습 기록을 모두 지울까요?')) {
      state.records = []; saveRecords(); renderReport(); showToast('이 기기의 오늘 학습 기록을 지웠어요.');
    }
  });
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeModal(button.dataset.close)));
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeModal(backdrop.id); }));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const opened = document.querySelector('.modal-backdrop:not([hidden])');
      if (opened) closeModal(opened.id);
    }
  });

  updateSelectors();
  updateMode();
  initVoice();
  updateProgress();
})();
