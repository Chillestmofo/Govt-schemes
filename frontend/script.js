const API_BASE_URL = '';

// ============ Toast Notification System ============
function showToast(message, type = 'error') {
    const existing = document.querySelectorAll('.toast-notification');
    existing.forEach((t, i) => { if (i >= 4) t.remove(); });
    const toast = document.createElement('div');
    toast.className = `toast-notification toast-${type}`;
    toast.innerHTML = `<span class="toast-msg">${message}</span><button class="toast-close" onclick="this.parentElement.remove()">&times;</button>`;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => { toast.classList.remove('toast-visible'); setTimeout(() => toast.remove(), 300); }, 4000);
}

// ============ DOMPurify Helper ============
function sanitizeHTML(html) {
    if (typeof DOMPurify !== 'undefined') {
        return DOMPurify.sanitize(html, { ADD_ATTR: ['onclick', 'data-scheme', 'title'] });
    }
    return html; // fallback if CDN fails
}

// ============ JWT Refresh Helper ============
async function refreshAccessToken() {
    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) return false;
    try {
        const res = await fetch(API_BASE_URL + '/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken })
        });
        if (!res.ok) { localStorage.removeItem('refresh_token'); return false; }
        const data = await res.json();
        if (data.success) { return true; }
        return false;
    } catch { return false; }
}

// ============ WebSocket Chat Client ============
let chatWebSocket = null;
let wsReconnectAttempts = 0;
const WS_MAX_RECONNECT = 5;

function connectChatWebSocket() {
    if (chatWebSocket && chatWebSocket.readyState === WebSocket.OPEN) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/chat`;
    try {
        chatWebSocket = new WebSocket(wsUrl);
        chatWebSocket.onopen = () => { wsReconnectAttempts = 0; console.log('WebSocket connected'); };
        chatWebSocket.onclose = () => {
            chatWebSocket = null;
            if (wsReconnectAttempts < WS_MAX_RECONNECT) {
                wsReconnectAttempts++;
                setTimeout(connectChatWebSocket, Math.min(1000 * wsReconnectAttempts, 5000));
            }
        };
        chatWebSocket.onerror = () => { chatWebSocket = null; };
    } catch { chatWebSocket = null; }
}

function sendViaWebSocket(message, history) {
    return new Promise((resolve, reject) => {
        if (!chatWebSocket || chatWebSocket.readyState !== WebSocket.OPEN) {
            reject(new Error('WebSocket not connected'));
            return;
        }
        const chatBox = document.getElementById("chat-box");
        const msgDiv = document.createElement("div");
        msgDiv.className = "message bot";
        msgDiv.innerHTML = '<div class="message-bubble"><span class="ws-stream"></span></div><div class="message-label">Assistant</div>';
        chatBox.appendChild(msgDiv);
        const streamEl = msgDiv.querySelector('.ws-stream');
        let fullReply = '';

        chatWebSocket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'chunk') {
                fullReply += data.content;
                streamEl.textContent = fullReply;
                chatBox.scrollTop = chatBox.scrollHeight;
            } else if (data.type === 'done') {
                streamEl.innerHTML = sanitizeHTML(marked.parse(data.reply || fullReply));
                chatBox.scrollTop = chatBox.scrollHeight;
                resolve(data);
            } else if (data.type === 'error') {
                streamEl.textContent = 'An error occurred. Please try again.';
                reject(new Error(data.message));
            }
        };
        chatWebSocket.send(JSON.stringify({
            message,
            history,
            source_lang: 'auto',
            target_lang: currentLanguage,
            user_id: currentUser ? currentUser.user_id : null
        }));
    });
}

// Try connecting WebSocket on page load
setTimeout(connectChatWebSocket, 1000);

// ============ State Management ============
let currentUser = null;
let sessionId = null;
let chatHistory = [];
let isAuthWall = false;

// Scheme Finder State
// Scheme Finder State
let schemeFormData = {
    name: '',
    email: '',
    password: '',
    gender: null,
    age: null,
    state: '',
    area: null,
    category: null,
    is_disabled: null,
    is_minority: null,
    is_student: null,
    employment_status: null,
    is_govt_employee: null,
    annual_income: null,
    family_income: null
};

// Language State
let currentLanguage = localStorage.getItem('language') || 'en_XX';

// ============ Initialization ============
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuthStatus();

    initializeLanguage();
    initializeLanguageDropdowns();
    initializeCustomSelects();

    // Check for ?chat=true query param (redirect from login/signup)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('chat') === 'true') {
        startChat();
        // Clean up URL
        window.history.replaceState({}, document.title, '/');
    }

    // Check for ?verify=true query param (show verification modal after signup)
    if (urlParams.get('verify') === 'true') {
        // Load form data from sessionStorage for comparison
        const storedData = sessionStorage.getItem('signupFormData');
        if (storedData) {
            try {
                const formData = JSON.parse(storedData);
                // Populate schemeFormData for comparison
                schemeFormData.name = formData.name || '';
                schemeFormData.age = formData.age;
                schemeFormData.gender = formData.gender;
                schemeFormData.category = formData.category;
                schemeFormData.annual_income = formData.annual_income;
            } catch (e) {
                console.error('Failed to parse signup form data:', e);
            }
        }
        // Open verification modal
        openVerificationModal();
        // Clean up URL
        window.history.replaceState({}, document.title, '/');
    }
});

async function checkAuthStatus() {
    try {
        const response = await fetch(API_BASE_URL + '/auth/me', {
            credentials: 'include'
        });
        const data = await response.json();

        sessionId = data.session_id;

        if (data.is_logged_in) {
            currentUser = {
                name: data.user_name,
                user_id: data.user_id
            };
            updateUIForLoggedInUser();
        } else {
            // Try loading local profile saved in browser
            const savedProfile = localStorage.getItem('userProfile');
            const savedUser = localStorage.getItem('currentUser');
            if (savedProfile && savedUser) {
                try {
                    schemeFormData = { ...schemeFormData, ...JSON.parse(savedProfile) };
                    currentUser = JSON.parse(savedUser);
                    updateUIForLoggedInUser();
                    console.log('[LocalProfile] Restored local profile for:', currentUser.name);
                } catch (e) {
                    currentUser = null;
                    updateUIForAnonymousUser();
                }
            } else {
                currentUser = null;
                updateUIForAnonymousUser();
            }
        }
    } catch (error) {
        // Backend unreachable — still try to load local profile
        const savedProfile = localStorage.getItem('userProfile');
        const savedUser = localStorage.getItem('currentUser');
        if (savedProfile && savedUser) {
            try {
                schemeFormData = { ...schemeFormData, ...JSON.parse(savedProfile) };
                currentUser = JSON.parse(savedUser);
                updateUIForLoggedInUser();
            } catch (e) { /* ignore */ }
        }
        console.error('Auth check failed:', error);
    }
}

function updateUIForLoggedInUser() {
    if (!currentUser) return;

    const userMenu = document.getElementById('user-menu');
    const authButtons = document.getElementById('auth-buttons');
    const userNameDisplay = document.getElementById('user-name-display');
    const navbarSigninBtn = document.getElementById('navbar-signin-btn');
    const navbarUserMenu = document.getElementById('navbar-user-menu');
    const navbarUserName = document.getElementById('navbar-user-name');
    const heroGuestButtons = document.getElementById('hero-guest-buttons');
    const heroLoggedinButtons = document.getElementById('hero-loggedin-buttons');

    // Chat Header
    if (userMenu) userMenu.classList.remove('hidden');
    if (authButtons) authButtons.classList.add('hidden');
    if (userNameDisplay) {
        const greeting = (window.TRANSLATIONS && window.TRANSLATIONS[currentLanguage] && window.TRANSLATIONS[currentLanguage]['greeting_hello']) || 'Hello';
        userNameDisplay.textContent = `${greeting}, ${currentUser.name}`;
    }

    // Navbar
    if (navbarSigninBtn) navbarSigninBtn.style.display = 'none';
    if (navbarUserMenu) navbarUserMenu.classList.remove('hidden');
    if (navbarUserName) {
        const greeting = (window.TRANSLATIONS && window.TRANSLATIONS[currentLanguage] && window.TRANSLATIONS[currentLanguage]['greeting_hello']) || 'Hello';
        navbarUserName.textContent = `${greeting}, ${currentUser.name}`;
    }

    // Hero
    if (heroGuestButtons) heroGuestButtons.classList.add('hidden');
    if (heroLoggedinButtons) heroLoggedinButtons.classList.remove('hidden');

    const responseLimitBanner = document.getElementById('response-limit-banner');
    if (responseLimitBanner) {
        responseLimitBanner.classList.add('hidden');
    }
}

function updateUIForAnonymousUser() {
    const userMenu = document.getElementById('user-menu');
    const authButtons = document.getElementById('auth-buttons');
    const navbarSigninBtn = document.getElementById('navbar-signin-btn');
    const navbarUserMenu = document.getElementById('navbar-user-menu');
    const navbarUserName = document.getElementById('navbar-user-name');
    const heroGuestButtons = document.getElementById('hero-guest-buttons');
    const heroLoggedinButtons = document.getElementById('hero-loggedin-buttons');

    // Chat Header
    if (userMenu) userMenu.classList.add('hidden');
    if (authButtons) authButtons.classList.remove('hidden');

    // Navbar
    if (navbarSigninBtn) navbarSigninBtn.style.display = '';
    if (navbarUserMenu) navbarUserMenu.classList.add('hidden');
    if (navbarUserName) navbarUserName.textContent = '';

    // Hero
    if (heroGuestButtons) heroGuestButtons.classList.remove('hidden');
    if (heroLoggedinButtons) heroLoggedinButtons.classList.add('hidden');
}


// ============ Language Management ============
let i18nOriginals = {};

function initializeLanguage() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        i18nOriginals[el.dataset.i18n] = el.innerHTML.trim();
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        i18nOriginals[el.dataset.i18nPlaceholder + '_pl'] = el.getAttribute('placeholder');
    });

    if (currentLanguage !== 'en_XX') {
        translatePage(currentLanguage);
    }

    updateLanguageDisplay(currentLanguage);
}

function initializeLanguageDropdowns() {
    const mainItems = document.querySelectorAll('#language-menu .dropdown-item');
    mainItems.forEach(item => {
        item.addEventListener('click', () => selectLanguage(item.dataset.lang, 'main'));
    });

    const chatItems = document.querySelectorAll('#chat-language-menu .dropdown-item');
    chatItems.forEach(item => {
        item.addEventListener('click', () => selectLanguage(item.dataset.lang, 'chat'));
    });
}

function toggleLanguageDropdown() {
    const dropdown = document.getElementById('language-dropdown');
    dropdown.classList.toggle('open');
    const closeHandler = (e) => {
        if (!dropdown.contains(e.target)) {
            dropdown.classList.remove('open');
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

function toggleChatLanguageDropdown() {
    const dropdown = document.getElementById('chat-language-dropdown');
    dropdown.classList.toggle('open');
    const closeHandler = (e) => {
        if (!dropdown.contains(e.target)) {
            dropdown.classList.remove('open');
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

async function selectLanguage(langCode, source) {
    const langNames = {
        'hi_IN': 'हिन्दी', 'ta_IN': 'தமிழ்', 'te_IN': 'తెలుగు',
        'bn_IN': 'বাংলা', 'mr_IN': 'मराठी', 'gu_IN': 'ગુજરાતી',
        'kn_IN': 'ಕನ್ನಡ', 'ml_IN': 'മലയാളം', 'pa_IN': 'ਪੰਜਾਬੀ',
        'or_IN': 'ଓଡ଼ିଆ', 'as_IN': 'অসমীয়া', 'ur_IN': 'اردو',
        'ks_IN': 'कॉशुर', 'mai_IN': 'मैथिली'
    };

    currentLanguage = langCode;
    localStorage.setItem('language', langCode);
    updateLanguageDisplay(langCode);

    if (currentUser) {
        updateUIForLoggedInUser();
    }

    document.getElementById('language-dropdown')?.classList.remove('open');
    document.getElementById('chat-language-dropdown')?.classList.remove('open');

    const isOnChatPage = !document.getElementById('chat-page')?.classList.contains('hidden');
    const overlay = document.getElementById('language-loading-overlay');

    if (isOnChatPage && langCode !== 'en_XX' && overlay) {
        const title = document.getElementById('language-loading-title');
        const status = document.getElementById('language-loading-status');
        const langName = langNames[langCode] || langCode;

        title.textContent = `Switching to ${langName}...`;
        status.textContent = 'Translating conversation...';
        overlay.classList.remove('hidden');

        try {
            await translatePage(langCode);
        } finally {
            setTimeout(() => overlay.classList.add('hidden'), 500);
        }
    } else {
        await translatePage(langCode);
    }
}

async function translatePage(targetLang) {
    if (targetLang === 'en_XX') {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            if (i18nOriginals[key]) {
                el.innerHTML = i18nOriginals[key];
            }
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.dataset.i18nPlaceholder + '_pl';
            if (i18nOriginals[key]) {
                el.setAttribute('placeholder', i18nOriginals[key]);
            }
        });
        const cardLang = document.getElementById('card-current-lang-display');
        if (cardLang) cardLang.textContent = 'English';
        updateAgeDropdown(targetLang);
        return;
    }

    const preTranslations = window.TRANSLATIONS && window.TRANSLATIONS[targetLang];
    const textElements = Array.from(document.querySelectorAll('[data-i18n]'));
    const placeholderElements = Array.from(document.querySelectorAll('[data-i18n-placeholder]'));

    const needsApiTranslation = [];
    const elementsForApi = [];

    const cacheKey = `trans_cache_${targetLang}`;
    let localCache = {};
    try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) localCache = JSON.parse(cached);
    } catch (e) {
        console.warn('Failed to load translation cache', e);
    }

    const processElement = (el, type) => {
        let key, originalText;
        if (type === 'text') {
            key = el.dataset.i18n;
            originalText = i18nOriginals[key] || el.innerText.trim();
        } else {
            key = el.dataset.i18nPlaceholder;
            originalText = i18nOriginals[key + '_pl'] || el.getAttribute('placeholder');
        }

        if (preTranslations) {
            if (type === 'text' && preTranslations[key] !== undefined) {
                el.innerHTML = preTranslations[key];
                return;
            } else if (type === 'placeholder') {
                if (preTranslations[key + '_pl'] !== undefined) {
                    el.setAttribute('placeholder', preTranslations[key + '_pl']);
                    return;
                } else if (preTranslations[key] !== undefined) {
                    el.setAttribute('placeholder', preTranslations[key]);
                    return;
                }
            }
        }

        if (localCache[originalText]) {
            if (type === 'text') {
                el.innerText = localCache[originalText];
            } else {
                el.setAttribute('placeholder', localCache[originalText]);
            }
            return;
        }

        needsApiTranslation.push(originalText);
        elementsForApi.push({ el, type, originalText });
    };

    textElements.forEach(el => processElement(el, 'text'));
    placeholderElements.forEach(el => processElement(el, 'placeholder'));

    const langNames = {
        'hi_IN': 'हिन्दी', 'ta_IN': 'தமிழ்', 'te_IN': 'తెలుగు',
        'bn_IN': 'বাংলা', 'mr_IN': 'मराठी', 'gu_IN': 'ગુજરાતી',
        'kn_IN': 'ಕನ್ನಡ', 'ml_IN': 'മലയാളം', 'pa_IN': 'ਪੰਜਾਬੀ',
        'or_IN': 'ଓଡ଼ିଆ', 'as_IN': 'অসমীয়া', 'ur_IN': 'اردو'
    };
    const cardLang = document.getElementById('card-current-lang-display');
    if (cardLang) cardLang.textContent = langNames[targetLang] || 'English';

    const isOnChatPage = !document.getElementById('chat-page')?.classList.contains('hidden');
    if (needsApiTranslation.length > 0 && !isOnChatPage) {
        try {
            document.body.style.cursor = 'wait';
            const uniqueTexts = [...new Set(needsApiTranslation)];
            const response = await fetch(API_BASE_URL + '/translate/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    texts: uniqueTexts,
                    source_lang: 'en_XX',
                    target_lang: targetLang
                })
            });
            const data = await response.json();
            if (data.translations) {
                const translationMap = {};
                uniqueTexts.forEach((text, idx) => {
                    if (data.translations[idx]) {
                        translationMap[text] = data.translations[idx];
                        localCache[text] = data.translations[idx];
                    }
                });
                elementsForApi.forEach(item => {
                    const translatedText = translationMap[item.originalText];
                    if (translatedText) {
                        if (item.type === 'text') {
                            item.el.innerText = translatedText;
                        } else {
                            item.el.setAttribute('placeholder', translatedText);
                        }
                    }
                });
                try {
                    localStorage.setItem(cacheKey, JSON.stringify(localCache));
                } catch (e) {
                    console.warn('Quota exceeded for localStorage', e);
                }
            }
        } catch (error) {
            console.error('Page translation failed:', error);
        } finally {
            document.body.style.cursor = 'default';
        }
    }
}

function updateLanguageDisplay(langCode) {
    const langNames = {
        'en_XX': 'English',
        'hi_IN': 'हिन्दी',
        'or_IN': 'ଓଡ଼ିଆ',
        'as_IN': 'অসমীয়া',
        'bn_IN': 'বাংলা',
        'gu_IN': 'ગુજરાતી',
        'kn_IN': 'ಕನ್ನಡ',
        'ml_IN': 'മലയാളം',
        'mr_IN': 'मराठी',
        'pa_IN': 'ਪੰਜਾਬੀ',
        'ta_IN': 'தமிழ்',
        'te_IN': 'తెలుగు',
        'ur_IN': 'اردو',
        'ks_IN': 'कॉशुर',
        'mai_IN': 'मैथिली'
    };

    const displayName = langNames[langCode] || 'English';
    const mainDisplay = document.getElementById('current-lang');
    const chatDisplay = document.getElementById('chat-current-lang');

    if (mainDisplay) mainDisplay.textContent = displayName;
    if (chatDisplay) chatDisplay.textContent = displayName;

    document.querySelectorAll('.dropdown-item').forEach(item => {
        item.classList.toggle('active', item.dataset.lang === langCode);
    });
}

function initializeCustomSelects() {
    const stateTrigger = document.getElementById('state-select-trigger');
    const stateWrapper = document.getElementById('state-select-wrapper');
    if (stateTrigger && stateWrapper) {
        stateTrigger.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeAllCustomSelects(stateWrapper);
            stateWrapper.classList.toggle('open');
        });
    }

    initCustomSelectOptions('age');
    initCustomSelectOptions('state');

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.custom-select-wrapper')) {
            closeAllCustomSelects();
        }
    });
}

function closeAllCustomSelects(exceptWrapper = null) {
    document.querySelectorAll('.custom-select-wrapper').forEach(wrapper => {
        if (wrapper !== exceptWrapper) {
            wrapper.classList.remove('open');
        }
    });
}

function initCustomSelectOptions(type) {
    const optionsContainer = document.getElementById(`${type}-select-options`);
    const trigger = document.getElementById(`${type}-select-trigger`);
    const hiddenInput = document.getElementById(`sf-${type}`);
    const wrapper = document.getElementById(`${type}-select-wrapper`);

    if (!optionsContainer) return;

    optionsContainer.querySelectorAll('.custom-select-option').forEach(option => {
        option.addEventListener('click', (e) => {
            e.stopPropagation();
            const value = option.dataset.value;
            const text = option.textContent;

            if (hiddenInput) {
                hiddenInput.value = value;
            }

            if (trigger) {
                trigger.querySelector('span').textContent = value ? text : (type === 'age' ? 'Select age' : 'Select State');
            }

            optionsContainer.querySelectorAll('.custom-select-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            if (value) {
                option.classList.add('selected');
            }

            if (type === 'age') {
                schemeFormData.age = value ? parseInt(value) : null;
            } else if (type === 'state') {
                schemeFormData.state = value;
            }

            if (wrapper) {
                wrapper.classList.remove('open');
            }
        });
    });
}

// ============ Carousel Navigation ============
function scrollCarousel(direction) {
    const carousel = document.getElementById('schemes-carousel');
    if (!carousel) return;

    const scrollAmount = 260;
    carousel.scrollBy({
        left: direction * scrollAmount,
        behavior: 'smooth'
    });
}

// ============ Page Navigation ============
function startChat() {
    document.getElementById('landing-page').classList.add('hidden');
    document.getElementById('chat-page').classList.remove('hidden');
    if (currentUser) {
        updateUIForLoggedInUser();
    } else {
        updateUIForAnonymousUser();
    }
    
    // Trigger initial greeting if chat history is empty
    if (chatHistory.length === 0) {
        triggerInitialGreeting();
    }
}

async function triggerInitialGreeting() {
    try {
        const response = await fetch(API_BASE_URL + '/chat', {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: 'include',
            body: JSON.stringify({
                message: "initial_greeting_trigger",
                history: [],
                target_lang: currentLanguage,
                user_id: currentUser ? currentUser.user_id : null
            })
        });
        const data = await response.json();
        if (data.reply) {
            addMessage("Assistant", data.reply, "bot");
            chatHistory.push({ role: "assistant", content: data.reply });
        }
    } catch (e) {
        console.error("Initial greeting failed", e);
    }
}

function continueAsGuest() {
    startChat();
}

// ============ Scheme Finder Modal ============
async function openSchemeFinderModal(mode = 'signup') {
    const modal = document.getElementById('scheme-finder-modal');
    const title = modal.querySelector('.modal-title');
    const submitBtn = document.getElementById('sf-submit-btn');

    if (!submitBtn) {
        console.error("CRITICAL ERROR: 'sf-submit-btn' not found in DOM");
        return;
    }

    resetSchemeFinderUI();

    if (mode === 'edit') {
        const createAccountHeader = modal.querySelector('h3[data-i18n="sf_h_account"]');
        if (createAccountHeader) {
            const authContainer = createAccountHeader.closest('.form-section');
            if (authContainer) authContainer.style.display = 'none';
        }

        if (currentUser && currentUser.name) {
            title.textContent = `Edit Profile: ${currentUser.name}`;
            title.removeAttribute('data-i18n');
        } else {
            title.textContent = "Edit Your Profile";
        }

        const ocrSection = document.getElementById('edit-ocr-section');
        if (ocrSection) ocrSection.classList.remove('hidden');

        submitBtn.innerHTML = "<span>Edit Profile & Continue Chat</span>";
        submitBtn.removeAttribute('onclick');
        submitBtn.onclick = submitEditProfile;

        try {
            const response = await fetch(API_BASE_URL + '/edit');
            const profile = await response.json();
            if (profile && Object.keys(profile).length > 0) {
                populateSchemeForm(profile);
            }
        } catch (e) {
            console.error("Failed to load profile", e);
        }

    } else {
        const createAccountHeader = modal.querySelector('h3[data-i18n="sf_h_account"]');
        if (createAccountHeader) {
            const authContainer = createAccountHeader.closest('.form-section');
            if (authContainer) authContainer.style.display = 'block';
        }

        title.setAttribute('data-i18n', 'sf_modal_title');
        title.textContent = "Help us find the best schemes for you";

        submitBtn.innerHTML = "<span data-i18n='sf_btn_submit'>Submit Profile & Start Chat</span>";
        submitBtn.onclick = submitSchemeForm;

        if (typeof translatePage === 'function' && currentLanguage) {
            translatePage(currentLanguage);
        }
    }

    modal.classList.remove('hidden');
}

function closeSchemeFinderModal() {
    document.getElementById('scheme-finder-modal').classList.add('hidden');
}

function handleSchemeFinderOverlayClick(event) {
    if (event.target === event.currentTarget) {
        closeSchemeFinderModal();
    }
}

function resetSchemeFormData() {
    schemeFormData = {
        name: '',
        email: '',
        password: '',
        gender: null,
        age: null,
        state: '',
        area: null,
        category: null,
        is_disabled: null,
        is_minority: null,
        is_student: null,
        employment_status: null,
        is_govt_employee: null,
        annual_income: null,
        family_income: null
    };

    document.querySelectorAll('.scheme-step input').forEach(input => input.value = '');
    document.querySelectorAll('.scheme-step select').forEach(select => select.selectedIndex = 0);
    document.querySelectorAll('.selection-card, .toggle-btn, .category-card').forEach(el => {
        el.classList.remove('selected');
    });
}

// ============ Edit Profile ============
function populateSchemeForm(data) {
    if (data.name) document.getElementById('sf-name').value = data.name;
    if (data.email) document.getElementById('sf-email').value = data.email;

    if (data.age) {
        document.getElementById('sf-age').value = data.age;
        const ageTrigger = document.getElementById('age-select-trigger');
        if (ageTrigger) {
            ageTrigger.querySelector('span').textContent = data.age.toString();
        }
        const ageOptions = document.getElementById('age-select-options');
        if (ageOptions) {
            ageOptions.querySelectorAll('.custom-select-option').forEach(opt => {
                opt.classList.toggle('selected', opt.dataset.value === data.age.toString());
            });
        }
    }

    if (data.state) {
        document.getElementById('sf-state').value = data.state;
        const stateOptions = document.getElementById('state-select-options');
        if (stateOptions) {
            const selectedOption = stateOptions.querySelector(`[data-value="${data.state}"]`);
            if (selectedOption) {
                const stateTrigger = document.getElementById('state-select-trigger');
                if (stateTrigger) {
                    stateTrigger.querySelector('span').textContent = selectedOption.textContent;
                }
                stateOptions.querySelectorAll('.custom-select-option').forEach(opt => {
                    opt.classList.toggle('selected', opt.dataset.value === data.state);
                });
            }
        }
    }

    if (data.annual_income) document.getElementById('sf-annual-income').value = data.annual_income;
    if (data.family_income) document.getElementById('sf-family-income').value = data.family_income;

    schemeFormData.name = data.name || schemeFormData.name;
    schemeFormData.email = data.email || schemeFormData.email;
    schemeFormData.gender = data.gender || schemeFormData.gender;
    schemeFormData.age = data.age || schemeFormData.age;
    schemeFormData.state = data.state || schemeFormData.state;
    schemeFormData.area = data.area || schemeFormData.area;
    schemeFormData.category = data.category || schemeFormData.category;
    schemeFormData.is_disabled = data.is_disabled !== undefined ? data.is_disabled : schemeFormData.is_disabled;
    schemeFormData.is_minority = data.is_minority !== undefined ? data.is_minority : schemeFormData.is_minority;
    schemeFormData.is_student = data.is_student !== undefined ? data.is_student : schemeFormData.is_student;
    schemeFormData.employment_status = data.employment_status || schemeFormData.employment_status;
    schemeFormData.is_govt_employee = data.is_govt_employee !== undefined ? data.is_govt_employee : schemeFormData.is_govt_employee;
    schemeFormData.annual_income = data.annual_income || schemeFormData.annual_income;
    schemeFormData.family_income = data.family_income || schemeFormData.family_income;

    highlightSelection('gender-selection', data.gender);
    highlightSelection('category-selection', data.category);
    highlightSelection('employment-selection', data.employment_status);

    highlightToggle('area-selection', data.area);
    highlightToggle('disability-selection', data.is_disabled);
    highlightToggle('minority-selection', data.is_minority);
    highlightToggle('student-selection', data.is_student);
    highlightToggle('govt-employee-selection', data.is_govt_employee);
}

function highlightSelection(containerId, value) {
    if (!value) return;
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.selection-card, .category-card').forEach(c => c.classList.remove('selected'));
    const target = container.querySelector(`[data-value="${value}"]`);
    if (target) target.classList.add('selected');
}

function highlightToggle(containerId, value) {
    if (value === null || value === undefined) return;
    const container = document.getElementById(containerId);
    if (!container) return;
    let stringVal = value;
    if (typeof value === 'boolean') {
        stringVal = value ? 'yes' : 'no';
    } else if (value === 1) {
        stringVal = 'yes';
    } else if (value === 0) {
        stringVal = 'no';
    }
    container.querySelectorAll('.toggle-btn').forEach(btn => btn.classList.remove('selected'));
    const target = container.querySelector(`[data-value="${stringVal}"]`);
    if (target) target.classList.add('selected');
}

async function submitEditProfile() {
    if (!validateFullForm()) return;
    collectFullFormData();
    const loading = document.getElementById('scheme-form-loading');
    if (loading) loading.classList.remove('hidden');

    try {
        const response = await fetch(API_BASE_URL + '/edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(schemeFormData)
        });
        const data = await response.json();
        if (data.success) {
            if (schemeFormData.name) {
                const currentUserDisplay = document.getElementById('user-name-display');
                if (currentUserDisplay) currentUserDisplay.textContent = `Hello, ${schemeFormData.name}`;
                currentUser.name = schemeFormData.name;
            }
            closeSchemeFinderModal();
        } else {
            showToast(data.message || 'Failed to update profile', 'error');
        }
    } catch (error) {
        console.error('Profile update error:', error);
        showToast('Profile update failed. Please try again.', 'error');
    } finally {
        if (loading) loading.classList.add('hidden');
    }
}

function resetSchemeFinderUI() {
    const modal = document.getElementById('scheme-finder-modal');
    const title = modal.querySelector('.modal-title');
    const submitBtn = document.getElementById('sf-submit-btn');
    const createAccountHeader = modal.querySelector('h3[data-i18n="sf_h_account"]');
    if (createAccountHeader) {
        const authContainer = createAccountHeader.closest('.form-section');
        if (authContainer) authContainer.style.display = 'block';
    }
    title.textContent = "Help us find the best schemes for you";
    title.setAttribute('data-i18n', 'sf_modal_title');
    const ocrSection = document.getElementById('edit-ocr-section');
    if (ocrSection) ocrSection.classList.add('hidden');
    submitBtn.innerHTML = "<span data-i18n='sf_btn_submit'>Submit Profile & Start Chat</span>";
    submitBtn.onclick = submitSchemeForm;
    document.querySelectorAll('#scheme-finder-modal input[type="text"], #scheme-finder-modal input[type="email"], #scheme-finder-modal input[type="password"], #scheme-finder-modal input[type="number"]').forEach(i => i.value = '');
    document.querySelectorAll('.selection-card.selected').forEach(c => c.classList.remove('selected'));
    document.querySelectorAll('.toggle-btn.selected').forEach(c => c.classList.remove('selected'));
    document.querySelectorAll('.category-card.selected').forEach(c => c.classList.remove('selected'));
    const ageTrigger = document.getElementById('age-select-trigger');
    if (ageTrigger) ageTrigger.querySelector('span').textContent = 'Select age';
    document.getElementById('sf-age').value = '';
    const stateTrigger = document.getElementById('state-select-trigger');
    if (stateTrigger) stateTrigger.querySelector('span').textContent = 'Select State';
    document.getElementById('sf-state').value = '';
    document.querySelectorAll('.custom-select-option.selected').forEach(c => c.classList.remove('selected'));
    schemeFormData = {
        gender: null,
        age: null,
        state: null,
        area: null,
        category: null,
        is_disabled: null,
        is_minority: null,
        is_student: null,
        employment_status: null,
        is_govt_employee: null,
        annual_income: null,
        family_income: null
    };
}

function validateFullForm() {
    const name = document.getElementById('sf-name').value.trim();
    const password = document.getElementById('sf-password').value;
    const createAccountHeader = document.querySelector('h3[data-i18n="sf_h_account"]');
    const authContainer = createAccountHeader ? createAccountHeader.closest('.form-section') : null;
    const isEditMode = authContainer && authContainer.style.display === 'none';
    if (!isEditMode) {
        if (!name || name.length < 2) {
            alert('Please enter your name (at least 2 characters)');
            return false;
        }
        const email = document.getElementById('sf-email').value.trim();
        if (email && !isValidEmail(email)) {
            alert('Please enter a valid email address (or leave it blank)');
            return false;
        }
        if (email && (!password || password.length < 6)) {
            alert('If you provide an email, password must be at least 6 characters');
            return false;
        }
    }
    if (!schemeFormData.gender) {
        alert('Please select your gender');
        return false;
    }
    if (!document.getElementById('sf-age').value) { alert('Please select your age'); return false; }
    if (!schemeFormData.area) { alert('Please select your area'); return false; }
    if (!schemeFormData.category) { alert('Please select your category'); return false; }
    if (schemeFormData.is_disabled === null || schemeFormData.is_disabled === undefined) {
        alert('Please indicate disability status');
        return false;
    }
    if (!schemeFormData.employment_status) { alert('Please select employment status'); return false; }
    if (schemeFormData.employment_status === 'other') {
        const otherVal = document.getElementById('sf-employment-other').value.trim();
        if (!otherVal) {
            alert('Please specify your employment status');
            return false;
        }
    }
    if (schemeFormData.is_govt_employee === null || schemeFormData.is_govt_employee === undefined) {
        alert('Please indicate govt employee status');
        return false;
    }
    return true;
}

function collectFullFormData() {
    schemeFormData.name = document.getElementById('sf-name').value.trim();
    schemeFormData.email = document.getElementById('sf-email').value.trim();
    schemeFormData.password = document.getElementById('sf-password').value;
    schemeFormData.age = parseInt(document.getElementById('sf-age').value) || null;
    schemeFormData.state = document.getElementById('sf-state').value;
    schemeFormData.city = document.getElementById('sf-city').value.trim();
    const annualIncome = document.getElementById('sf-annual-income').value;
    const familyIncome = document.getElementById('sf-family-income').value;
    schemeFormData.annual_income = annualIncome ? parseFloat(annualIncome) : null;
    schemeFormData.family_income = familyIncome ? parseFloat(familyIncome) : null;
    if (schemeFormData.employment_status === 'other') {
        schemeFormData.employment_status_other = document.getElementById('sf-employment-other').value.trim();
    }
}

async function submitSchemeForm() {
    if (!validateFullForm()) return;
    collectFullFormData();
    const loading = document.getElementById('scheme-form-loading');
    loading.classList.remove('hidden');
    const email = schemeFormData.email;
    const hasEmail = email && isValidEmail(email);
    try {
        if (hasEmail) {
            const response = await fetch(API_BASE_URL + '/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(schemeFormData)
            });
            const data = await response.json();
            if (data.success) {
                currentUser = { name: schemeFormData.name, user_id: data.user_id };
                localStorage.setItem('userProfile', JSON.stringify(schemeFormData));
                localStorage.setItem('currentUser', JSON.stringify(currentUser));
                updateUIForLoggedInUser();
                closeSchemeFinderModal();
                startChat();
            } else {
                alert(data.message || 'Failed to save profile');
            }
        } else {
            const localId = 'local_' + Date.now();
            currentUser = { name: schemeFormData.name, user_id: localId };
            schemeFormData.user_id = localId;
            localStorage.setItem('userProfile', JSON.stringify(schemeFormData));
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            updateUIForLoggedInUser();
            closeSchemeFinderModal();
            startChat();
        }
    } catch (error) {
        console.error('Profile save error:', error);
        const localId = 'local_' + Date.now();
        currentUser = { name: schemeFormData.name, user_id: localId };
        schemeFormData.user_id = localId;
        localStorage.setItem('userProfile', JSON.stringify(schemeFormData));
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        updateUIForLoggedInUser();
        closeSchemeFinderModal();
        startChat();
    } finally {
        loading.classList.add('hidden');
    }
}

function selectCard(element, type) {
    const container = element.parentElement;
    container.querySelectorAll('.selection-card').forEach(card => {
        card.classList.remove('selected');
    });
    element.classList.add('selected');
    if (type === 'gender') {
        schemeFormData.gender = element.dataset.value;
    } else if (type === 'employment') {
        schemeFormData.employment_status = element.dataset.value;
        const otherWrapper = document.getElementById('other-employment-wrapper');
        if (otherWrapper) {
            if (element.dataset.value === 'other') {
                otherWrapper.classList.remove('hidden');
            } else {
                otherWrapper.classList.add('hidden');
            }
        }
    }
}

function selectToggle(element, type) {
    const container = element.parentElement;
    container.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    element.classList.add('selected');
    const value = element.dataset.value === 'yes';
    switch (type) {
        case 'area':
            schemeFormData.area = element.dataset.value;
            break;
        case 'disability':
            schemeFormData.is_disabled = value;
            break;
        case 'minority':
            schemeFormData.is_minority = value;
            break;
        case 'student':
            schemeFormData.is_student = value;
            break;
        case 'govt-employee':
            schemeFormData.is_govt_employee = value;
            break;
    }
}

function selectCategory(element) {
    const container = element.parentElement;
    container.querySelectorAll('.category-card').forEach(card => {
        card.classList.remove('selected');
    });
    element.classList.add('selected');
    schemeFormData.category = element.dataset.value;
}

function openAuthModal(form = 'signin', authWall = false) {
    isAuthWall = authWall;
    const modal = document.getElementById('auth-modal');
    const authPrompt = document.getElementById('auth-prompt-message');
    if (authWall) {
        authPrompt.classList.remove('hidden');
    } else {
        authPrompt.classList.add('hidden');
    }
    clearErrors();
    modal.classList.remove('hidden');
    setTimeout(() => {
        document.getElementById('signin-email')?.focus();
    }, 100);
}

function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    modal.classList.add('hidden');
    isAuthWall = false;
}

function handleOverlayClick(event) {
    if (event.target === event.currentTarget) {
        if (!isAuthWall) {
            closeAuthModal();
        }
    }
}

function switchToSignInFromScheme(event) {
    event.preventDefault();
    closeSchemeFinderModal();
    openAuthModal('signin');
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function showError(fieldId, message) {
    const input = document.getElementById(fieldId);
    const errorEl = document.getElementById(`error-${fieldId}`);
    if (input && input.classList) {
        input.classList.add('error');
    }
    if (errorEl) {
        errorEl.textContent = message;
    }
}

function clearErrors() {
    document.querySelectorAll('.form-input').forEach(input => {
        input.classList.remove('error');
    });
    document.querySelectorAll('.form-error').forEach(error => {
        error.textContent = '';
    });
}

async function submitSignIn() {
    clearErrors();
    const email = document.getElementById('signin-email').value.trim();
    const password = document.getElementById('signin-password').value;
    let isValid = true;
    if (!email || !isValidEmail(email)) {
        showError('signin-email', 'Please enter a valid email address');
        isValid = false;
    }
    if (!password) {
        showError('signin-password', 'Please enter your password');
        isValid = false;
    }
    if (!isValid) return;
    showLoading(true);
    try {
        const response = await fetch(API_BASE_URL + '/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, password })
        });
        const data = await response.json();
        if (data.success) {
            currentUser = data.user;
            if (data.refresh_token) {
                localStorage.setItem('refresh_token', data.refresh_token);
            }
            updateUIForLoggedInUser();
            closeAuthModal();
            const inputWrapper = document.querySelector('.input-wrapper');
            if (inputWrapper) {
                inputWrapper.classList.remove('disabled');
            }
            startChat();
        } else {
            showError('signin-password', data.message);
        }
    } catch (error) {
        console.error('Login error:', error);
        showToast('Login failed. Please check your connection and try again.', 'error');
    } finally {
        showLoading(false);
    }
}

async function handleLogout() {
    try {
        await fetch(API_BASE_URL + '/auth/logout', {
            method: 'POST',
            credentials: 'include'
        });
        currentUser = null;
        localStorage.removeItem('refresh_token');
        updateUIForAnonymousUser();
        window.location.href = '/';
    } catch (error) {
        console.error('Logout error:', error);
        window.location.href = '/';
    }
}

function showLoading(show) {
    const loading = document.getElementById('form-loading');
    if (show) {
        loading.classList.remove('hidden');
    } else {
        loading.classList.add('hidden');
    }
}

async function sendMessage() {
    const input = document.getElementById("user-input");
    const chatBox = document.getElementById("chat-box");
    const welcomeMsg = document.querySelector(".welcome-message");
    if (welcomeMsg) {
        welcomeMsg.remove();
    }

    const message = input.value.trim();
    if (!message) return;

    addMessage("You", message, "user");
    input.value = "";

    try {
        const response = await fetch(API_BASE_URL + '/chat', {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            credentials: 'include',
            body: JSON.stringify({
                message: message,
                history: chatHistory,
                source_lang: "auto",
                target_lang: currentLanguage,
                user_id: currentUser ? currentUser.user_id : null,
                // For local-only users (no backend account), pass profile inline so chatbot knows their details
                guest_profile: (currentUser && currentUser.user_id && currentUser.user_id.startsWith('local_'))
                    ? {
                        name: schemeFormData.name,
                        age: schemeFormData.age,
                        gender: schemeFormData.gender,
                        state: schemeFormData.state,
                        area: schemeFormData.area,
                        category: schemeFormData.category,
                        annual_income: schemeFormData.annual_income,
                        is_disabled: schemeFormData.is_disabled,
                        is_minority: schemeFormData.is_minority,
                        is_student: schemeFormData.is_student,
                        employment_status: schemeFormData.employment_status
                      }
                    : undefined
            })

        });

        const data = await response.json();

        if (data.auth_required) {
            // Try token refresh before forcing re-login
            const refreshed = await refreshAccessToken();
            if (refreshed) {
                // Retry the request
                sendQuickAction(message);
                return;
            }
            disableChat();
            openAuthModal('signin', true);
            return;
        }

        if (data.remaining_free !== null && data.remaining_free !== undefined && !currentUser) {
            updateResponseLimitBanner(data.remaining_free);
        }

        chatHistory.push({ role: "user", content: message });
        chatHistory.push({ role: "assistant", content: data.reply });

        if (data.reply) {
            addMessage("Assistant", data.reply, "bot", data.sources);
        } else {
            addMessage("Assistant", "I'm sorry, I encountered an error. Please try again later.", "bot");
        }

    } catch (error) {
        console.error("Chat Error:", error);
        if (error.message.includes("Failed to fetch")) {
            showToast("Unable to connect to server. Please ensure the backend is running.", "error");
        } else {
            showToast("An error occurred. Please try again.", "error");
        }
        addMessage("Assistant", "Something went wrong. Please try again.", "bot");
    }
}

function addMessage(sender, text, className, sources = null) {
    if (!text) text = ""; // Safe handling for null/undefined
    const chatBox = document.getElementById("chat-box");

    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${className}`;

    let contentHtml = className === "bot" ? sanitizeHTML(marked.parse(text || "")) : text;

    // For bot messages: inject inline bookmark buttons next to scheme titles
    if (className === "bot" && currentUser) {
        const schemeNames = extractSchemeNamesFromResponse(text);
        if (schemeNames.length > 0) {
            schemeNames.forEach(name => {
                const escapedName = name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                const bookmarkBtn = `<button class="inline-bookmark-btn" title="Save ${name}" onclick="event.stopPropagation(); toggleSaveScheme(this, '${escapedName}')" data-scheme="${escapedName}"><svg class="bm-outline" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg><svg class="bm-filled" viewBox="0 0 24 24" width="15" height="15" fill="currentColor" stroke="currentColor" stroke-width="2" style="display:none"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>`;
                // Inject after the <strong> tag containing this scheme name
                const strongRegex = new RegExp(`(<strong>)(${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(</strong>)`, 'g');
                contentHtml = contentHtml.replace(strongRegex, `$1$2$3${bookmarkBtn}`);
            });
        }
    }

    msgDiv.innerHTML = `
        <div class="message-bubble">
            ${contentHtml}
        </div>
        <div class="message-label">${sender}</div>
    `;

    chatBox.appendChild(msgDiv);

    // Add quick action buttons after bot messages
    if (className === "bot" && text.length > 50) {
        // Extract scheme names from the response for contextual buttons
        const schemeNames = extractSchemeNamesFromResponse(text);

        // Detect if this is a greeting response (no schemes mentioned)
        const isGreeting = schemeNames.length === 0 ||
            text.toLowerCase().includes("welcome") ||
            text.toLowerCase().includes("hello") ||
            text.toLowerCase().includes("namaste") ||
            text.includes("स्वागत") ||
            text.includes("नमस्ते");

        // Get translations for current language
        const t = window.TRANSLATIONS && window.TRANSLATIONS[currentLanguage] ? window.TRANSLATIONS[currentLanguage] : {};

        const quickActionsDiv = document.createElement("div");
        quickActionsDiv.className = "quick-actions";

        // Translated labels with fallbacks
        const labelText = t.qa_label || "Quick Actions:";
        const findSchemesText = t.qa_find_schemes || "Find My Schemes";
        const browseCategoriesText = t.qa_browse_categories || "Browse Categories";
        const helpText = t.qa_help || "Help";
        const moreAboutText = t.qa_more_about || "More about";
        const moreSchemesText = t.qa_more_schemes || "More Schemes";
        const howToApplyText = t.qa_how_to_apply || "How to Apply";

        let buttonsHtml = `<div class="quick-actions-label">${labelText}</div><div class="quick-actions-buttons">`;

        if (isGreeting && schemeNames.length === 0) {
            // Greeting buttons - help user get started
            buttonsHtml += `<button class="quick-action-btn" onclick="sendQuickAction('Show me schemes I am eligible for')">${findSchemesText}</button>`;
            buttonsHtml += `<button class="quick-action-btn" onclick="sendQuickAction('What categories of schemes are available?')">${browseCategoriesText}</button>`;
            buttonsHtml += `<button class="quick-action-btn" onclick="sendQuickAction('How does this work?')">${helpText}</button>`;
        } else {
            // Scheme response buttons
            // Add "Tell me more" button for first scheme mentioned
            if (schemeNames.length > 0) {
                const shortName = schemeNames[0].substring(0, 15) + (schemeNames[0].length > 15 ? '...' : '');
                buttonsHtml += `<button class="quick-action-btn" onclick="sendQuickAction('Tell me more about ${schemeNames[0]}')">${moreAboutText} ${shortName}</button>`;
            }

            // Add general quick actions
            buttonsHtml += `<button class="quick-action-btn" onclick="sendQuickAction('Show me more schemes')">${moreSchemesText}</button>`;
            buttonsHtml += `<button class="quick-action-btn" onclick="sendQuickAction('How do I apply for these schemes?')">${howToApplyText}</button>`;
        }

        buttonsHtml += '</div>';
        quickActionsDiv.innerHTML = buttonsHtml;

        chatBox.appendChild(quickActionsDiv);
    }

    chatBox.scrollTop = chatBox.scrollHeight;
}

// ============ Save Scheme Helpers ============
async function toggleSaveScheme(btn, schemeName) {
    if (!currentUser) { openAuthModal('signin', true); return; }
    const isSaved = btn.classList.contains('saved');
    btn.disabled = true;
    try {
        if (isSaved) {
            await fetch(API_BASE_URL + '/api/v1/saved-schemes/' + encodeURIComponent(schemeName), {
                method: 'DELETE', credentials: 'include'
            });
            btn.classList.remove('saved');
            btn.querySelector('.bm-outline').style.display = '';
            btn.querySelector('.bm-filled').style.display = 'none';
        } else {
            await fetch(API_BASE_URL + '/api/v1/saved-schemes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ scheme_name: schemeName })
            });
            btn.classList.add('saved');
            btn.querySelector('.bm-outline').style.display = 'none';
            btn.querySelector('.bm-filled').style.display = '';
        }
    } catch (err) {
        console.error('Save scheme error:', err);
        showToast('Failed to save scheme. Please try again.', 'error');
    } finally {
        btn.disabled = false;
    }
}

// Extract scheme names from bot response text
function extractSchemeNamesFromResponse(text) {
    const schemeNames = [];
    // Look for patterns like [Scheme Name] or **[Scheme Name]**
    const patterns = [
        /\[([^\]]+)\]/g,  // [Scheme Name] - simple brackets
        /\*\*\[([^\]]+)\]\*\*/g,  // **[Scheme Name]**
        /\*\*([^*\n]+)\*\*\s*\n/g,  // **Scheme Name** at start of line
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const name = match[1].trim();
            // Filter out common non-scheme text
            if (name.length > 3 && name.length < 100 &&
                !schemeNames.includes(name) &&
                !name.toLowerCase().includes('why you') &&
                !name.toLowerCase().includes('benefit') &&
                !name.toLowerCase().includes('how to')) {
                schemeNames.push(name);
            }
        }
    }

    return schemeNames.slice(0, 3); // Max 3 schemes
}

// Send quick action as a message
function sendQuickAction(message) {
    const input = document.getElementById("user-input");
    if (input) {
        input.value = message;
        sendMessage();
    }
}

function disableChat() {
    const inputWrapper = document.querySelector('.input-wrapper');
    if (inputWrapper) {
        inputWrapper.classList.add('disabled');
    }
}

function updateResponseLimitBanner(remaining) {
    const banner = document.getElementById('response-limit-banner');
    const text = document.getElementById('responses-remaining');

    if (remaining <= 0) {
        banner.classList.add('hidden');
    } else {
        banner.classList.remove('hidden');
        text.textContent = `${remaining} free message${remaining !== 1 ? 's' : ''} remaining`;
    }
}

// ============ Scheme Carousel Functions ============
function schemeCarouselNext() {
    const track = document.getElementById('schemesTrack');
    // Scroll by card width (250px) + gap (24px)
    track.scrollBy({ left: 274, behavior: 'smooth' });
}

function schemeCarouselPrev() {
    const track = document.getElementById('schemesTrack');
    track.scrollBy({ left: -274, behavior: 'smooth' });
}

// ============ Verification Modal (Post Sign-Up OCR) ============
let verificationFile = null;

function openVerificationModal() {
    const modal = document.getElementById('verification-modal');
    resetVerificationModal();
    modal.classList.remove('hidden');
}

function closeVerificationModal() {
    document.getElementById('verification-modal').classList.add('hidden');
    verificationFile = null;
}

// Open verification modal from Edit Profile mode
function openVerificationModalFromEdit() {
    // Collect current form data for comparison
    collectFullFormData();
    // Close edit profile modal first
    closeSchemeFinderModal();
    // Open verification modal
    openVerificationModal();
}

function handleVerificationOverlayClick(event) {
    if (event.target === event.currentTarget) {
        skipVerification();
    }
}

function resetVerificationModal() {
    document.getElementById('verify-scan-section').classList.remove('hidden');
    document.getElementById('verify-file-display').classList.add('hidden');
    document.getElementById('verify-processing').classList.add('hidden');
    document.getElementById('verify-comparison').classList.add('hidden');
    document.getElementById('verify-error').classList.add('hidden');
    document.getElementById('verify-file-input').value = '';
    verificationFile = null;
}

function triggerVerificationFileInput() {
    document.getElementById('verify-file-input').click();
}

function handleVerificationFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        showVerificationError('File too large. Maximum size is 5MB.');
        return;
    }

    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
        showVerificationError('Invalid file type. Please upload PNG, JPG, or PDF.');
        return;
    }

    verificationFile = file;
    document.getElementById('verify-file-name').textContent = file.name;
    document.getElementById('verify-scan-section').classList.add('hidden');
    document.getElementById('verify-file-display').classList.remove('hidden');
    document.getElementById('verify-error').classList.add('hidden');
}

async function processVerificationDocument() {
    if (!verificationFile) {
        showVerificationError('Please select a file first.');
        return;
    }

    // Show processing
    document.getElementById('verify-file-display').classList.add('hidden');
    document.getElementById('verify-processing').classList.remove('hidden');
    document.getElementById('verify-error').classList.add('hidden');

    try {
        const formData = new FormData();
        formData.append('file', verificationFile);

        const response = await fetch(API_BASE_URL + '/api/v1/ocr', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'OCR processing failed');
        }

        const result = await response.json();

        if (result.success) {
            displayComparisonResults(result.extracted_fields);
        } else {
            throw new Error(result.message || 'Failed to extract data');
        }

    } catch (error) {
        console.error('OCR Error:', error);
        showVerificationError(error.message || 'Failed to process document. Please try again.');
        document.getElementById('verify-processing').classList.add('hidden');
        document.getElementById('verify-scan-section').classList.remove('hidden');
    }
}

// ============ Form OCR Quick Fill Helpers ============
let formOcrFile = null;
let lastExtractedData = null;

function handleOCRFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
        alert('File too large. Maximum size is 5MB.');
        return;
    }

    formOcrFile = file;
    document.getElementById('ocr-file-name').textContent = file.name;
    document.getElementById('ocr-scan-btn').style.display = 'block';
    document.getElementById('ocr-results').classList.add('hidden');
}

async function scanDocumentForOCR() {
    if (!formOcrFile) {
        alert('Please select a file first.');
        return;
    }

    document.getElementById('ocr-loading').classList.remove('hidden');
    document.getElementById('ocr-scan-btn').disabled = true;

    try {
        const formData = new FormData();
        formData.append('file', formOcrFile);

        const response = await fetch(API_BASE_URL + '/api/v1/ocr', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'OCR processing failed');
        }

        const result = await response.json();

        if (result.success) {
            lastExtractedData = result.extracted_fields;
            displayOcrResults(lastExtractedData);
        } else {
            throw new Error(result.message || 'Failed to extract data');
        }
    } catch (error) {
        console.error('OCR Error:', error);
        alert(error.message || 'Failed to process document. Please try again.');
    } finally {
        document.getElementById('ocr-loading').classList.add('hidden');
        document.getElementById('ocr-scan-btn').disabled = false;
    }
}

function displayOcrResults(data) {
    const resultsContainer = document.getElementById('ocr-results');
    const fieldsContainer = document.getElementById('ocr-fields');
    resultsContainer.classList.remove('hidden');
    
    let html = '<ul class="ocr-extracted-list">';
    if (data.name) html += `<li><strong>Name:</strong> ${data.name}</li>`;
    if (data.age) html += `<li><strong>Age:</strong> ${data.age}</li>`;
    if (data.gender) html += `<li><strong>Gender:</strong> ${data.gender}</li>`;
    if (data.state) html += `<li><strong>State:</strong> ${data.state}</li>`;
    if (data.area_type) html += `<li><strong>Area Type:</strong> ${data.area_type}</li>`;
    if (data.category) html += `<li><strong>Category:</strong> ${data.category.toUpperCase()}</li>`;
    if (data.annual_income) html += `<li><strong>Income:</strong> ₹${data.annual_income}</li>`;
    html += '</ul>';
    
    if (!data.name && !data.age && !data.gender && !data.state) {
        html = '<p class="form-hint" style="color:var(--danger)">Could not confidently extract fields. Please ensure the image is clear and text is readable.</p>';
        document.querySelector('#ocr-results .btn-success').style.display = 'none';
    } else {
        document.querySelector('#ocr-results .btn-success').style.display = 'inline-block';
    }
    
    fieldsContainer.innerHTML = html;
}

const STATE_MAP = {
    'AP': 'andhra_pradesh', 'AR': 'arunachal_pradesh', 'AS': 'assam', 'BR': 'bihar',
    'CG': 'chhattisgarh', 'GA': 'goa', 'GJ': 'gujarat', 'HR': 'haryana',
    'HP': 'himachal_pradesh', 'JH': 'jharkhand', 'KA': 'karnataka', 'KL': 'kerala',
    'MP': 'madhya_pradesh', 'MH': 'maharashtra', 'MN': 'manipur', 'ML': 'meghalaya',
    'MZ': 'mizoram', 'NL': 'nagaland', 'OR': 'odisha', 'PB': 'punjab',
    'RJ': 'rajasthan', 'SK': 'sikkim', 'TN': 'tamil_nadu', 'TG': 'telangana',
    'TR': 'tripura', 'UP': 'uttar_pradesh', 'UK': 'uttarakhand', 'WB': 'west_bengal',
    'AN': 'andaman_nicobar', 'CH': 'chandigarh', 'DL': 'delhi', 'JK': 'jammu_kashmir',
    'LA': 'ladakh', 'LD': 'lakshadweep', 'PY': 'puducherry'
};

function applyOCRDataToForm() {
    if (!lastExtractedData) return;
    const data = lastExtractedData;
    
    console.log('[OCR] Applying extracted data to form:', JSON.stringify(data));

    // Helper: directly set a custom dropdown (age or state) without needing click
    function setCustomDropdown(type, value) {
        if (!value) return;
        const strVal = String(value);
        const hiddenInput = document.getElementById(`sf-${type}`);
        const trigger = document.getElementById(`${type}-select-trigger`);
        const optionsContainer = document.getElementById(`${type}-select-options`);
        
        console.log(`[OCR setDropdown] type=${type} value=${strVal} hiddenInput=${!!hiddenInput} trigger=${!!trigger} optionsContainer=${!!optionsContainer}`);
        
        if (hiddenInput) hiddenInput.value = strVal;
        
        // Update schemeFormData
        if (type === 'age') {
            const ageInput = document.getElementById('sf-age');
            if (ageInput) ageInput.value = strVal;
            schemeFormData.age = parseInt(strVal);
            return;
        }
        if (type === 'state') schemeFormData.state = strVal;

        if (optionsContainer) {
            // Remove selected from all options
            optionsContainer.querySelectorAll('.custom-select-option').forEach(opt => opt.classList.remove('selected'));
            // Find and mark the matching option - use two separate lookups
            const matchedOpt = optionsContainer.querySelector(`.custom-select-option[data-value="${strVal.toUpperCase()}"]`)
                             || optionsContainer.querySelector(`.custom-select-option[data-value="${strVal}"]`);

            console.log(`[OCR setDropdown] matchedOpt found: ${!!matchedOpt} for value=${strVal.toUpperCase()}`);

            if (matchedOpt) {
                matchedOpt.classList.add('selected');
                if (trigger) {
                    const span = trigger.querySelector('span');
                    if (span) span.textContent = matchedOpt.textContent;
                    else trigger.innerHTML = `<span>${matchedOpt.textContent}</span>`;
                }
            } else if (trigger) {
                // Fallback: at minimum show the code value
                const span = trigger.querySelector('span');
                if (span) span.textContent = strVal;
                else trigger.innerHTML = `<span>${strVal}</span>`;
            }
        } else {
            console.warn(`[OCR setDropdown] optionsContainer #${type}-select-options NOT FOUND in DOM`);
        }
    }

    // Handle State with mapping
    if (data.state) {
        const mappedState = STATE_MAP[data.state.toUpperCase()] || data.state;
        setCustomDropdown('state', mappedState);
    }

    // Helper: directly select a toggle-btn or selection-card without needing a click event
    function setButtonSelection(containerId, value, dataKey) {
        if (!value) return;
        const container = document.getElementById(containerId);
        if (!container) return;
        
        // Remove selected from siblings
        container.querySelectorAll('.selection-card, .toggle-btn, .category-card').forEach(btn => btn.classList.remove('selected'));
        
        // Find matching button
        const btn = container.querySelector(`[data-value="${value.toLowerCase()}"]`);
        if (btn) {
            btn.classList.add('selected');
            // Also update schemeFormData
            if (dataKey) schemeFormData[dataKey] = value.toLowerCase();
        }
    }

    // --- Name ---
    if (data.name) {
        document.getElementById('sf-name').value = data.name;
    }

    // --- Age (direct dropdown set) ---
    if (data.age) {
        setCustomDropdown('age', data.age);
    }

    // --- Annual Income ---
    if (data.annual_income) {
        const incEl = document.getElementById('sf-annual-income');
        if (incEl) incEl.value = data.annual_income;
        schemeFormData.annual_income = parseFloat(data.annual_income);
    }

    // --- Gender ---
    if (data.gender) {
        setButtonSelection('gender-selection', data.gender, 'gender');
    }

    // --- Category ---
    if (data.category) {
        setButtonSelection('category-selection', data.category, 'category');
    }

    // --- State (direct dropdown set) ---
    if (data.state) {
        setCustomDropdown('state', data.state);
    }

    // --- Area Type ---
    if (data.area_type) {
        setButtonSelection('area-selection', data.area_type, 'area');
    }

    // --- City ---
    if (data.city) {
        const cityEl = document.getElementById('sf-city');
        if (cityEl) cityEl.value = data.city;
        schemeFormData.city = data.city;
    }
    
    console.log('[OCR] schemeFormData after fill:', JSON.stringify(schemeFormData));
    alert('✅ Details auto-filled! Please review and fill in any missing fields.');
}

function displayComparisonResults(scannedData) {
    document.getElementById('verify-processing').classList.add('hidden');
    document.getElementById('verify-comparison').classList.remove('hidden');

    const tbody = document.getElementById('comparison-table-body');
    tbody.innerHTML = '';

    // Fields to compare
    const fields = [
        { key: 'name', label: 'Name', entered: schemeFormData.name },
        { key: 'age', label: 'Age', entered: schemeFormData.age },
        { key: 'gender', label: 'Gender', entered: schemeFormData.gender },
        { key: 'category', label: 'Category', entered: schemeFormData.category },
        { key: 'annual_income', label: 'Annual Income', entered: schemeFormData.annual_income }
    ];

    fields.forEach(field => {
        const enteredValue = field.entered || '-';
        const scannedValue = scannedData[field.key] || '-';

        // Check if values match
        const isMatch = compareValues(field.entered, scannedData[field.key]);

        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="field-name">${field.label}</td>
            <td>${formatValue(enteredValue)}</td>
            <td class="${isMatch ? 'value-match' : (scannedValue === '-' ? 'value-empty' : 'value-mismatch')}">${formatValue(scannedValue)}</td>
        `;
        tbody.appendChild(row);
    });

    // Update action buttons - add "Proceed" button
    const actionsDiv = document.querySelector('.verify-actions');
    actionsDiv.innerHTML = `
        <button class="btn btn-verify-scan btn-full" onclick="proceedAfterVerification()" style="margin-bottom: 8px;">
            Proceed to Chat
        </button>
        <button class="btn btn-outline btn-full" onclick="resetVerificationModal()">
            Scan Another Document
        </button>
    `;
}

function compareValues(entered, scanned) {
    if (!entered || !scanned) return false;
    if (entered === '-' || scanned === '-') return false;

    // Normalize for comparison
    const normalizedEntered = String(entered).toLowerCase().trim();
    const normalizedScanned = String(scanned).toLowerCase().trim();

    return normalizedEntered === normalizedScanned;
}

function formatValue(value) {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
}

function showVerificationError(message) {
    const errorDiv = document.getElementById('verify-error');
    document.getElementById('verify-error-message').textContent = message;
    errorDiv.classList.remove('hidden');
}

function skipVerification() {
    closeVerificationModal();
    startChat();
}

function proceedAfterVerification() {
    closeVerificationModal();
    startChat();
}

// Modify submitSchemeForm to show verification modal after sign-up
const originalSubmitSchemeForm = submitSchemeForm;
submitSchemeForm = async function () {
    if (!validateFullForm()) return;
    collectFullFormData();

    const loading = document.getElementById('scheme-form-loading');
    loading.classList.remove('hidden');

    try {
        const response = await fetch(API_BASE_URL + '/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(schemeFormData)
        });

        const data = await response.json();

        if (data.success) {
            currentUser = {
                name: schemeFormData.name,
                user_id: data.user_id
            };
            updateUIForLoggedInUser();
            closeSchemeFinderModal();

            // Show verification modal instead of directly starting chat
            openVerificationModal();
        } else {
            alert(data.message || 'Failed to save profile');
        }
    } catch (error) {
        console.error('Profile save error:', error);
        alert('An error occurred. Please try again.');
    } finally {
        loading.classList.add('hidden');
    }
};
