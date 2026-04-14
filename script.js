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

// --- Ad and Unlocking Logic Variables ---
let adUrl = null; // Will be loaded from Firebase
const adWatchTime = 10000; // 10 seconds for the "ad" (used for ad window duration, not unlock delay)
const localStorageKey_UnlockedEpisodes = "unlockedEpisodeIds";
const localStorageKey_LastIP = "lastKnownUserIP";
const firebaseNode_IPUnlocks = "ipUnlocks";
const firebaseNode_Settings = "settings";
const IP_UNLOCK_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const EARNING_COOLDOWN_MS = 24 * 60 * 60 * 1000; // User can earn from same episode every 24 hours

let unlockedEpisodeIds = JSON.parse(localStorage.getItem(localStorageKey_UnlockedEpisodes) || '[]');
// let currentlyCountingDownEpisodeId = null; // No longer needed for countdown logic
// let activeTimers = {}; // No longer needed for countdown logic
let episodeDataStore = {}; // Store all fetched episode data
let currentPublicIP = null; // User's public IP
let currentUser = null;
let userWalletListener = null;
let episodeEarningTimeout = null;


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
}

function getYouTubeEmbedUrl(url) {
    const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:m\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=|embed\/|v\/|)([a-zA-Z0-9_-]{11})(?:\S+)?/i;
    const match = url.match(youtubeRegex);
    if (match && match[1]) {
        return `https://www.youtube.com/embed/${match[1]}?autoplay=1&rel=0&modestbranding=1`;
    }
    return null;
}

function playEpisode(url, episodeId) {
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

    if (episodeEarningTimeout) {
        clearTimeout(episodeEarningTimeout);
        episodeEarningTimeout = null;
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

    if (currentUser && episodeId && episodeDataStore[episodeId]?.earningTime && episodeDataStore[episodeId]?.pkrPerWatch) {
        trackEpisodeEarning(episodeId, episodeDataStore[episodeId].earningTime, episodeDataStore[episodeId].pkrPerWatch);
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
    // If adUrl is not set in Firebase, then all non-free episodes are effectively free
    if (!adUrl) {
        console.log("No ad URL configured. Unlocking without ad.");
        finishAdWatching(episodeId, null, true); // Pass true for noAdMode, no adWindow needed
        return;
    }

    if (unlockedEpisodeIds.includes(episodeId)) {
        playEpisode(episodeDataStore[episodeId].url, episodeId);
        return;
    }
    
    const isCurrentlyIpUnlocked = await isEpisodeUnlockedByIP(episodeId);
    if (isCurrentlyIpUnlocked) {
        if (!unlockedEpisodeIds.includes(episodeId)) {
            unlockedEpisodeIds.push(episodeId);
            localStorage.setItem(localStorageKey_UnlockedEpisodes, JSON.stringify(unlockedEpisodeIds));
            alert(`"${episodeTitle}" is IP unlocked! Playing now.`);
            loadEpisodesRealtime(true, episodeId);
        } else {
            playEpisode(episodeDataStore[episodeId].url, episodeId);
        }
        return;
    }

    // --- INSTANT UNLOCK LOGIC (No timer) ---
    // Open ad window
    const adWindow = window.open(adUrl, '_blank');
    if (!adWindow) {
        alert("Pop-up blocked! Please allow pop-ups for this site to watch the ad and unlock the episode.");
        updatePlayerMessage("Pop-up blocked. Allow pop-ups to watch ad.", true);
        return;
    }

    // Immediately trigger finishAdWatching, no delay.
    // The ad window will still be opened and attempt to close after adWatchTime.
    finishAdWatching(episodeId, adWindow, false); // Pass false for noAdMode as ad was opened.
}

async function finishAdWatching(episodeId, adWindow = null, noAdMode = false) {
    // This function is now called immediately after opening the ad (or if noAdMode)
    // No need to check currentlyCountingDownEpisodeId here as there's no countdown.

    unlockedEpisodeIds.push(episodeId);
    localStorage.setItem(localStorageKey_UnlockedEpisodes, JSON.stringify(unlockedEpisodeIds));

    if (!noAdMode) { // Only record IP unlock if ad was actually opened
        const ip = await getPublicIP();
        if (ip) {
            const encodedIp = encodeURIComponent(ip).replace(/\./g, '%2E');
            try {
                await db.ref(`${firebaseNode_IPUnlocks}/${episodeId}/${encodedIp}`).set({
                    unlockedAt: Date.now()
                });
                console.log(`Episode ${episodeId} IP unlock recorded for ${ip}.`);
            } catch (error) {
                console.error("Error recording IP unlock in Firebase:", error);
                alert("An error occurred while trying to save IP unlock status.");
            }
        } else {
            console.warn("Could not get public IP to record unlock status.");
        }

        alert(`"${episodeDataStore[episodeId].title}" unlocked! Playing now.`);
    } else {
        // This branch is for when adUrl is null from admin, instant unlock without ad pop-up.
        alert(`"${episodeDataStore[episodeId].title}" unlocked automatically (no ad configured)! Playing now.`);
    }
    
    // Schedule the ad window to close after adWatchTime, even if unlock is instant.
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

    // Since unlock is instant, we want to re-render and play.
    loadEpisodesRealtime(true, episodeId);
}

// --- Earning Logic ---

async function trackEpisodeEarning(episodeId, earningTimeSeconds, pkrAmount) {
    if (!currentUser) {
        console.log("User not logged in, cannot earn.");
        return;
    }

    if (!episodeDataStore[episodeId] || !episodeDataStore[episodeId].earningTime || !episodeDataStore[episodeId].pkrPerWatch) {
        console.warn("Episode does not have earning configuration:", episodeId);
        return;
    }

    const userId = currentUser.uid;
    const userEarningsRef = db.ref(`users/${userId}/earnings/${episodeId}`);

    const snapshot = await userEarningsRef.once('value');
    if (snapshot.exists()) {
        const lastEarnedAt = snapshot.val().lastEarnedAt;
        if (Date.now() - lastEarnedAt < EARNING_COOLDOWN_MS) {
            console.log(`Already earned from episode ${episodeId} recently. Cooldown active.`);
            return;
        }
    }

    console.log(`Starting earning timer for episode ${episodeId} for ${earningTimeSeconds} seconds.`);
    
    if (episodeEarningTimeout) {
        clearTimeout(episodeEarningTimeout);
    }

    episodeEarningTimeout = setTimeout(async () => {
        try {
            await db.ref(`users/${userId}/walletBalance`).transaction((currentBalance) => {
                const newBalance = (currentBalance || 0) + pkrAmount;
                console.log(`User ${userId} earned PKR ${pkrAmount}. New balance: ${newBalance}`);
                return newBalance;
            });

            await userEarningsRef.set({ lastEarnedAt: Date.now() }); // FIXED TYPO: Date.now()

            alert(`You earned PKR ${pkrAmount.toFixed(2)} for watching "${episodeDataStore[episodeId].title}"!`);

        } catch (error) {
            console.error("Error processing earning:", error);
            alert("Error while processing earnings.");
        } finally {
            episodeEarningTimeout = null;
        }
    }, earningTimeSeconds * 1000);
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
    } else if (mode === 'signup') {
        modalTitle.textContent = 'Sign Up';
        loginButton.style.display = 'block';
        signUpButton.style.display = 'block';
        logoutButton.style.display = 'none';
    } else if (mode === 'logout_prompt') {
        modalTitle.textContent = `Logged in as: ${currentUser.email}`;
        loginButton.style.display = 'none';
        signUpButton.style.display = 'none';
        logoutButton.style.display = 'block';
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
        updateAuthUI(user);
        listenToUserWallet(user.uid);
    } else {
        currentUser = null;
        updateAuthUI(null);
        stopListeningToUserWallet();
        if (episodeEarningTimeout) {
            clearTimeout(episodeEarningTimeout);
            episodeEarningTimeout = null;
        }
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
        db.ref(`users/${currentUser.uid}/walletBalance`).off('value', userWalletListener);
        userWalletListener = null;
    }
    walletBalanceSpan.textContent = 'PKR 0.00';
}

// Load general settings (like ad URL) from Firebase
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


// --- Real-time Data Loading ---
async function loadEpisodesRealtime(playAfterUnlock = false, unlockedEpisodeIdToPlay = null) {
    // No active timers to clear as there's no countdown
    // currentlyCountingDownEpisodeId = null; // Reset current countdown

    db.ref('episodes').on('value', async function(snapshot) {
        console.log("Firebase snapshot received:", snapshot.val());
        const episodesData = snapshot.val();
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

                    const isIpUnlocked = await isEpisodeUnlockedByIP(episodeId);
                    if (episode.isFree || unlockedEpisodeIds.includes(episodeId) || isIpUnlocked || !adUrl) {
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

            if (videoDisplayArea.style.display !== 'block') { // Check if video area is empty
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

    }, function(error) {
        console.error("Firebase read error:", error);
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

// Initial setup on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    updatePlayerMessage("Loading episodes...", false);
    loadSettings().then(() => getPublicIP()).then(() => loadEpisodesRealtime()); 
});

auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        updateAuthUI(user);
        listenToUserWallet(user.uid);
    } else {
        currentUser = null;
        updateAuthUI(null);
        stopListeningToUserWallet();
        if (episodeEarningTimeout) {
            clearTimeout(episodeEarningTimeout);
            episodeEarningTimeout = null;
        }
    }
});
