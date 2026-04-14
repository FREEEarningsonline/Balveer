// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyC-xJBe4UE_JSPrFShIPf_HZsa89fELfF0",
    authDomain: "movie-d805c.firebaseapp.com",
    projectId: "movie-d805c",
    storageBucket: "movie-d805c.firebasestorage.app",
    messagingSenderId: "930897906608",
    appId: "1:930897906608:web:834df31949ad4f42eaa475",
    measurementId: "G-N8TV69N7L1"
};

// Initialize Firebase (using the compat version)
const app = firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

// DOM elements
const playerInitialMessage = document.getElementById('player-initial-message');
const episodeListDiv = document.getElementById('episode-list');
const videoDisplayArea = document.getElementById('videoDisplayArea');

// Header elements
const profileButton = document.getElementById('profileButton');
const userStatusSpan = document.getElementById('userStatus');
const walletBalanceSpan = document.getElementById('walletBalance');

// Auth modal elements
const authModal = document.getElementById('authModal');
const closeModalButton = document.getElementById('closeModalButton');
const modalTitle = document.getElementById('modalTitle');
const authEmailInput = document.getElementById('authEmail');
const authPasswordInput = document.getElementById('authPassword');
const loginButton = document.getElementById('loginButton');
const signUpButton = document.getElementById('signUpButton');
const logoutButton = document.getElementById('logoutButton');
const authErrorP = document.getElementById('authError');

// NEW: Earning Display Card elements
const earningDisplayCard = document.getElementById('earningDisplayCard');
const earningMessageSpan = document.getElementById('earningMessage');
const earningTimerSpan = document.getElementById('earningTimer');
const earningAmountSpan = document.getElementById('earningAmount');
const earningProgressBar = document.getElementById('earningProgressBar');

// --- Ad and Unlocking Logic Variables ---
let adUrl = null;
const adWatchTime = 10000;
const localStorageKey_UnlockedEpisodes = "unlockedEpisodeIds";
const localStorageKey_LastIP = "lastKnownUserIP";
const firebaseNode_IPUnlocks = "ipUnlocks";
const firebaseNode_Settings = "settings";
const IP_UNLOCK_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const EARNING_COOLDOWN_MS = 24 * 60 * 60 * 1000; // User can earn from same episode every 24 hours

let unlockedEpisodeIds = JSON.parse(localStorage.getItem(localStorageKey_UnlockedEpisodes) || '[]');
let episodeDataStore = {};
let currentPublicIP = null;
let currentUser = null;
let userWalletListener = null;
let episodeEarningInterval = null; // NEW: Renamed for earning interval
let earningTimeLeft = 0; // NEW: Tracks seconds remaining for earning
let totalEarningTime = 0; // NEW: Total duration for earning


// --- Helper Functions ---
function updatePlayerMessage(message, isError = false) {
    if (playerInitialMessage) {
        playerInitialMessage.textContent = message;
        playerInitialMessage.style.display = 'block';
        playerInitialMessage.style.color = isError ? '#dc3545' : '#e01f28';
    }
    if (videoDisplayArea) {
        videoDisplayArea.style.display = 'none';
        videoDisplayArea.innerHTML = '';
    }
    // Hide earning card if player message is shown
    hideEarningCard(); 
}

function getYouTubeEmbedUrl(url) {
    const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:m\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=|embed\/|v\/|)([a-zA-Z0-9_-]{11})(?:\S+)?/i;
    const match = url.match(youtubeRegex);
    if (match && match[1]) {
        return `https://www.youtube.com/embed/${match[1]}?autoplay=1&rel=0&modestbranding=1`;
    }
    return null;
}

function playEpisode(url, episodeId) { // episodeId is now always passed
    if (!url) {
        console.error("Attempted to play episode with null/undefined URL.");
        updatePlayerMessage("Error: Video URL is missing.", true);
        return;
    }

    if (!videoDisplayArea) {
        console.error("Video display area not found!");
        updatePlayerMessage("Error: Player setup failed.", true);
        return;
    }

    // NEW: Always hide earning card and clear interval when starting new episode
    hideEarningCard(); 
    if (episodeEarningInterval) {
        clearInterval(episodeEarningInterval);
        episodeEarningInterval = null;
    }


    if (playerInitialMessage) {
        playerInitialMessage.style.display = 'none';
    }
    videoDisplayArea.style.display = 'block';
    videoDisplayArea.innerHTML = '';

    const youtubeEmbedUrl = getYouTubeEmbedUrl(url);

    if (youtubeEmbedUrl) {
        console.log("Embedding YouTube video:", youtubeEmbedUrl);
        const iframe = document.createElement('iframe');
        iframe.setAttribute('width', '100%');
        iframe.setAttribute('height', '100%');
        iframe.setAttribute('src', youtubeEmbedUrl);
        iframe.setAttribute('frameborder', '0');
        iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
        iframe.setAttribute('allowfullscreen', '');
        videoDisplayArea.appendChild(iframe);
    } else {
        console.log("Playing direct video URL (assuming MP4):", url);
        const videoElement = document.createElement('video');
        videoElement.setAttribute('controls', '');
        videoElement.setAttribute('autoplay', '');
        videoElement.setAttribute('width', '100%');
        videoElement.setAttribute('height', '100%');
        videoElement.style.borderRadius = '10px';
        videoElement.style.objectFit = 'contain';

        const sourceElement = document.createElement('source');
        sourceElement.src = url;
        sourceElement.type = 'video/mp4';
        videoElement.appendChild(sourceElement);

        videoDisplayArea.appendChild(videoElement);

        videoElement.load();
        videoElement.play().catch(error => {
            console.warn("Autoplay was prevented for direct video:", error);
        });
    }

    // NEW: Initiate earning display after starting video playback
    if (currentUser && episodeId && episodeDataStore[episodeId]?.earningTime > 0 && episodeDataStore[episodeId]?.pkrPerWatch > 0) {
        startEarningDisplay(episodeId, episodeDataStore[episodeId].earningTime, episodeDataStore[episodeId].pkrPerWatch);
        // We will call trackEpisodeEarning from within the earning display timer
    }
}

async function getPublicIP() {
    if (currentPublicIP) {
        return currentPublicIP;
    }
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        currentPublicIP = data.ip;
        localStorage.setItem(localStorageKey_LastIP, currentPublicIP);
        console.log("Fetched public IP:", currentPublicIP);
        return currentPublicIP;
    } catch (error) {
        console.error("Failed to fetch public IP from API:", error);
        currentPublicIP = localStorage.getItem(localStorageKey_LastIP);
        if (currentPublicIP) {
            console.warn("Using last known IP from local storage due to API failure.");
            return currentPublicIP;
        }
        return null;
    }
}

async function isEpisodeUnlockedByIP(episodeId) {
    if (!currentUser) { // Guests cannot check/create IP unlocks in Firebase
        return false;
    }
    const ip = await getPublicIP();
    if (!ip) return false;

    const encodedIp = encodeURIComponent(ip).replace(/\./g, '%2E');

    try {
        const snapshot = await db.ref(`${firebaseNode_IPUnlocks}/${episodeId}/${encodedIp}`).once('value');
        if (snapshot.exists()) {
            const unlockData = snapshot.val();
            const unlockedAt = unlockData.unlockedAt;
            const currentTime = Date.now();

            if (currentTime - unlockedAt < IP_UNLOCK_DURATION_MS) {
                console.log(`Episode ${episodeId} is IP unlocked for ${ip} until ${new Date(unlockedAt + IP_UNLOCK_DURATION_MS).toLocaleString()}`);
                return true;
            } else {
                console.log(`Episode ${episodeId} IP unlock for ${ip} expired.`);
                db.ref(`${firebaseNode_IPUnlocks}/${episodeId}/${encodedIp}`).remove().catch(e => console.error("Error removing expired IP unlock:", e));
            }
        }
    } catch (error) {
        console.error("Error checking IP unlock status in Firebase:", error);
    }
    return false;
}

// --- Ad and Unlock Logic ---

async function attemptUnlock(episodeId, episodeTitle) {
    if (unlockedEpisodeIds.includes(episodeId)) {
        playEpisode(episodeDataStore[episodeId].url, episodeId);
        return;
    }
    
    const isCurrentlyIpUnlocked = await isEpisodeUnlockedByIP(episodeId);
    if (isCurrentlyIpUnlocked) {
        if (!unlockedEpisodeIds.includes(episodeId)) {
            unlockedEpisodeIds.push(episodeId);
            localStorage.setItem(localStorageKey_UnlockedEpisodes, JSON.stringify(unlockedEpisodeIds));
        }
        alert(`"${episodeTitle}" is IP unlocked! Playing now.`);
        handleEpisodesData(window.episodeDataStore, true, episodeId);
        return;
    }

    if (!adUrl) {
        console.log("No ad URL configured. Unlocking without ad.");
        finishAdWatching(episodeId, null, true);
        return;
    }

    if (!currentUser) {
        alert("Please log in to unlock this episode via ad and save your unlock status for 24 hours.");
        showAuthModal('login');
        return;
    }
    
    const adWindow = window.open(adUrl, '_blank');
    if (!adWindow) {
        alert("Pop-up blocked! Please allow pop-ups for this site to watch the ad and unlock the episode.");
        updatePlayerMessage("Pop-up blocked. Allow pop-ups to watch ad.", true);
        return;
    }

    finishAdWatching(episodeId, adWindow, false);
}

async function finishAdWatching(episodeId, adWindow = null, noAdMode = false) {
    unlockedEpisodeIds.push(episodeId);
    localStorage.setItem(localStorageKey_UnlockedEpisodes, JSON.stringify(unlockedEpisodeIds));

    if (!noAdMode && currentUser) { 
        const ip = await getPublicIP();
        if (ip) {
            const encodedIp = encodeURIComponent(ip).replace(/\./g, '%2E');
            try {
                await db.ref(`${firebaseNode_IPUnlocks}/${episodeId}/${encodedIp}`).set({
                    unlockedAt: Date.now()
                });
                console.log(`Episode ${episodeId} IP unlock recorded for ${ip} for user ${currentUser.uid}.`);
            } catch (error) {
                console.error("Error recording IP unlock in Firebase:", error);
                alert("An error occurred while trying to save IP unlock status.");
            }
        } else {
            console.warn("Could not get public IP to record unlock status.");
        }

        alert(`"${episodeDataStore[episodeId].title}" unlocked! Playing now.`);
    } else if (noAdMode) {
        alert(`"${episodeDataStore[episodeId].title}" unlocked automatically (no ad configured)! Playing now.`);
    } else {
        alert(`"${episodeDataStore[episodeId].title}" unlocked for this session only. Log in to save for 24 hours.`);
    }
    
    if (adWindow) {
        setTimeout(() => {
            if (!adWindow.closed) {
                try {
                    adWindow.close();
                } catch (e) {
                    console.warn("Could not close ad window after timeout:", e);
                }
            }
        }, adWatchTime);
    }

    handleEpisodesData(window.episodeDataStore, true, episodeId);
}

// --- Earning Display and Logic ---

function showEarningCard(episodeId, remainingTime, pkrAmount, totalDuration) {
    if (!earningDisplayCard || !earningMessageSpan || !earningTimerSpan || !earningAmountSpan || !earningProgressBar) {
        console.error("Earning display card elements not found.");
        return;
    }

    earningTimerSpan.textContent = remainingTime;
    earningAmountSpan.textContent = `PKR ${pkrAmount.toFixed(2)}`;
    
    const progressPercent = ((totalDuration - remainingTime) / totalDuration) * 100;
    earningProgressBar.style.width = `${progressPercent}%`;

    earningDisplayCard.style.display = 'flex'; // Show the card
}

function hideEarningCard() {
    if (earningDisplayCard) {
        earningDisplayCard.style.display = 'none';
    }
    if (episodeEarningInterval) {
        clearInterval(episodeEarningInterval);
        episodeEarningInterval = null;
    }
    earningTimeLeft = 0;
    totalEarningTime = 0;
}


async function startEarningDisplay(episodeId, earningTimeSeconds, pkrAmount) {
    if (!currentUser) { // Must be logged in to display earning card
        hideEarningCard();
        return;
    }

    const userId = currentUser.uid;
    const userEarningsRef = db.ref(`users/${userId}/earnings/${episodeId}`);

    const snapshot = await userEarningsRef.once('value');
    if (snapshot.exists()) {
        const lastEarnedAt = snapshot.val().lastEarnedAt;
        if (Date.now() - lastEarnedAt < EARNING_COOLDOWN_MS) {
            console.log(`Already earned from episode ${episodeId} recently. Cooldown active.`);
            hideEarningCard(); // Hide card if cooldown is active
            return;
        }
    }

    // Set initial state for earning
    totalEarningTime = earningTimeSeconds;
    earningTimeLeft = earningTimeSeconds;

    showEarningCard(episodeId, earningTimeLeft, pkrAmount, totalEarningTime);

    // Clear any previous interval to prevent duplicates
    if (episodeEarningInterval) {
        clearInterval(episodeEarningInterval);
    }

    // Start interval for earning countdown and progress bar
    episodeEarningInterval = setInterval(async () => {
        earningTimeLeft--;
        showEarningCard(episodeId, earningTimeLeft, pkrAmount, totalEarningTime);

        if (earningTimeLeft <= 0) {
            clearInterval(episodeEarningInterval);
            episodeEarningInterval = null;
            hideEarningCard(); // Hide card after earning
            
            // Call earning processing only AFTER display is done
            await processEarning(episodeId, pkrAmount, userEarningsRef);
        }
    }, 1000); // Update every second
}


async function processEarning(episodeId, pkrAmount, userEarningsRef) {
    try {
        await db.ref(`users/${currentUser.uid}/walletBalance`).transaction((currentBalance) => {
            const newBalance = (currentBalance || 0) + pkrAmount;
            console.log(`User ${currentUser.uid} earned PKR ${pkrAmount}. New balance: ${newBalance}`);
            return newBalance;
        });

        await userEarningsRef.set({ lastEarnedAt: Date.now() });

        alert(`You earned PKR ${pkrAmount.toFixed(2)} for watching "${episodeDataStore[episodeId].title}"!`);

    } catch (error) {
        console.error("Error processing earning:", error);
        alert("Error while processing earnings.");
    }
}


// --- Authentication Logic ---

function showAuthModal(mode) {
    authErrorP.textContent = '';
    authEmailInput.value = '';
    authPasswordInput.value = '';

    if (mode === 'login') {
        modalTitle.textContent = 'Login';
        loginButton.style.display = 'block';
        signUpButton.style.display = 'block';
        logoutButton.style.display = 'none';
        authEmailInput.style.display = 'block';
        authPasswordInput.style.display = 'block';

    } else if (mode === 'signup') {
        modalTitle.textContent = 'Sign Up';
        loginButton.style.display = 'block';
        signUpButton.style.display = 'block';
        logoutButton.style.display = 'none';
        authEmailInput.style.display = 'block';
        authPasswordInput.style.display = 'block';

    } else if (mode === 'logout_prompt') {
        modalTitle.textContent = `Logged in as: ${currentUser.email}`;
        loginButton.style.display = 'none';
        signUpButton.style.display = 'none';
        logoutButton.style.display = 'block';
        authEmailInput.style.display = 'none';
        authPasswordInput.style.display = 'none';
    }
    authModal.style.display = 'flex';
}

function hideAuthModal() {
    authModal.style.display = 'none';
}

async function handleLogin() {
    const email = authEmailInput.value;
    const password = authPasswordInput.value;
    authErrorP.textContent = '';

    if (!email || !password) {
        authErrorP.textContent = 'Please enter email and password.';
        return;
    }

    try {
        await auth.signInWithEmailAndPassword(email, password);
        hideAuthModal();
    } catch (error) {
        console.error("Login error:", error);
        authErrorP.textContent = `Login failed: ${error.message}`;
    }
}

async function handleSignUp() {
    const email = authEmailInput.value;
    const password = authPasswordInput.value;
    authErrorP.textContent = '';

    if (!email || !password) {
        authErrorP.textContent = 'Please enter email and password.';
        return;
    }

    try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        await db.ref(`users/${userCredential.user.uid}`).set({
            email: userCredential.user.email,
            walletBalance: 0.00,
            createdAt: Date.now()
        });
        hideAuthModal();
        alert('Account created successfully! You are now logged in.');
    } catch (error) {
        console.error("Sign up error:", error);
        authErrorP.textContent = `Sign up failed: ${error.message}`;
    }
}

async function handleLogout() {
    try {
        await auth.signOut();
        hideAuthModal();
        alert('Logged out successfully.');
    } catch (error) {
        console.error("Logout error:", error);
        authErrorP.textContent = `Logout failed: ${error.message}`;
    }
}

function updateAuthUI(user) {
    if (user) {
        currentUser = user;
        userStatusSpan.textContent = 'User';
        profileButton.onclick = () => showAuthModal('logout_prompt');
    } else {
        currentUser = null;
        userStatusSpan.textContent = 'Guest';
        walletBalanceSpan.textContent = 'PKR 0.00';
        profileButton.onclick = () => showAuthModal('login');
    }
}

function listenToUserWallet(uid) {
    if (userWalletListener) {
        stopListeningToUserWallet();
    }
    userWalletListener = db.ref(`users/${uid}/walletBalance`).on('value', (snapshot) => {
        const balance = snapshot.val();
        walletBalanceSpan.textContent = `PKR ${(balance || 0).toFixed(2)}`;
    }, (error) => {
        console.error("Wallet listener error:", error);
        walletBalanceSpan.textContent = "Error";
    });
}

function stopListeningToUserWallet() {
    if (userWalletListener) {
        const uid = currentUser ? currentUser.uid : null;
        if (uid) {
            db.ref(`users/${uid}/walletBalance`).off('value', userWalletListener);
        }
        userWalletListener = null;
    }
    walletBalanceSpan.textContent = 'PKR 0.00';
}

async function loadSettings() {
    try {
        const snapshot = await db.ref(firebaseNode_Settings).once('value');
        if (snapshot.exists()) {
            const settings = snapshot.val();
            if (settings.adUrl && settings.adUrl.trim() !== '') {
                adUrl = settings.adUrl.trim();
                console.log("Ad URL loaded from Firebase:", adUrl);
            } else {
                adUrl = null;
                console.log("No Ad URL configured in Firebase. Locked episodes will unlock without ad.");
            }
        } else {
            adUrl = null;
            console.log("No settings node found in Firebase. Locked episodes will unlock without ad.");
        }
    } catch (error) {
        console.error("Error loading settings from Firebase:", error);
        adUrl = null;
        console.log("Failed to load Ad URL. Locked episodes will unlock without ad.");
    }
}

async function handleEpisodesData(episodesData, playAfterUnlock = false, unlockedEpisodeIdToPlay = null) {
    window.episodeDataStore = episodesData;
    let episodesListHtml = '';
    let firstEpisodeUrl = null;
    const episodeKeys = episodesData ? Object.keys(episodesData) : [];

    if (episodeKeys.length > 0) {
        const firstEpisodeKey = episodeKeys[0];
        firstEpisodeUrl = episodesData[firstEpisodeKey]?.url;

        for (const episodeId of episodeKeys) {
            const episode = episodesData[episodeId];
            if (episode && typeof episode.title === 'string' && typeof episode.url === 'string' && episode.title.trim() !== '' && episode.url.trim() !== '') {
                const escapedTitle = episode.title.replace(/'/g, "\\'");
                const escapedUrl = episode.url.replace(/'/g, "\\'");
                
                const buttonAttributes = `class="episode-btn" data-episode-id="${episodeId}"`;

                let isPlayable = false;
                if (episode.isFree) {
                    isPlayable = true;
                } else if (unlockedEpisodeIds.includes(episodeId)) {
                    isPlayable = true;
                } else if (!adUrl) {
                    isPlayable = true;
                } else {
                    if (currentUser) {
                        const isIpUnlocked = await isEpisodeUnlockedByIP(episodeId);
                        if (isIpUnlocked) {
                            isPlayable = true;
                            if (!unlockedEpisodeIds.includes(episodeId)) {
                                unlockedEpisodeIds.push(episodeId);
                                localStorage.setItem(localStorageKey_UnlockedEpisodes, JSON.stringify(unlockedEpisodeIds));
                            }
                        }
                    }
                }

                if (isPlayable) {
                    episodesListHtml += `
                        <div class="episode-container">
                            <button ${buttonAttributes} onclick="playEpisode('${escapedUrl}', '${episodeId}')">${episode.title}</button>
                        </div>
                    `;
                } else {
                    episodesListHtml += `
                        <div class="episode-container">
                            <button ${buttonAttributes} class="episode-btn locked" onclick="attemptUnlock('${episodeId}', '${escapedTitle}')">
                                ${episode.title} <span class="lock-icon">🔒</span>
                            </button>
                        </div>
                    `;
                }
            } else {
                console.warn(`Skipping malformed or incomplete episode with ID: ${episodeId}`, episode);
            }
        }

        if (videoDisplayArea.style.display !== 'block') {
            updatePlayerMessage("Select an Episode to Play", false);
        }
    } else {
        episodesListHtml = '<p class="no-episodes-message">No episodes available. Please add some from the Admin Panel.</p>';
        updatePlayerMessage("No episodes to play.", false);
    }

    episodeListDiv.innerHTML = episodesListHtml;

    if (playAfterUnlock && unlockedEpisodeIdToPlay && episodeDataStore[unlockedEpisodeIdToPlay]) {
        playEpisode(episodeDataStore[unlockedEpisodeIdToPlay].url, unlockedEpisodeIdToPlay);
    } else if (!playAfterUnlock && firstEpisodeUrl && videoDisplayArea.innerHTML === '') {
        playEpisode(firstEpisodeUrl, episodeKeys[0]);
    }
}

async function initApp() {
    updatePlayerMessage("Loading episodes...", false);
    await loadSettings();
    await getPublicIP();
    
    db.ref('episodes').on('value', async function(snapshot) {
        await handleEpisodesData(snapshot.val());
    }, function(error) {
        console.error("Firebase read error for episodes:", error);
        episodeListDiv.innerHTML = '<p class="no-episodes-message" style="color:#dc3545;">Error loading episodes: ' + error.message + '</p>';
        updatePlayerMessage("Error loading episodes. Check console for details.", true);
    });
}

// --- Event Listeners ---
profileButton.addEventListener('click', () => {
    if (currentUser) {
        showAuthModal('logout_prompt');
    } else {
        showAuthModal('login');
    }
});
closeModalButton.addEventListener('click', hideAuthModal);
loginButton.addEventListener('click', handleLogin);
signUpButton.addEventListener('click', handleSignUp);
logoutButton.addEventListener('click', handleLogout);

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        updateAuthUI(user);
        listenToUserWallet(user.uid);
        if (window.episodeDataStore) {
            handleEpisodesData(window.episodeDataStore);
        }
    } else {
        currentUser = null;
        updateAuthUI(null);
        stopListeningToUserWallet();
        if (episodeEarningInterval) { // Fixed variable name here
            clearInterval(episodeEarningInterval); // Clear earning timer on logout
            episodeEarningInterval = null;
        }
        if (window.episodeDataStore) {
            handleEpisodesData(window.episodeDataStore);
        }
    }
});
