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

// DOM elements
const playerInitialMessage = document.getElementById('player-initial-message');
const episodeListDiv = document.getElementById('episode-list');
const videoDisplayArea = document.getElementById('videoDisplayArea');

// --- Ad and Unlocking Logic Variables ---
const adUrl = "https://toolswebsite205.blogspot.com";
const adWatchTime = 10000; // 10 seconds for the "ad"
const localStorageKey_UnlockedEpisodes = "unlockedEpisodeIds";

let unlockedEpisodeIds = JSON.parse(localStorage.getItem(localStorageKey_UnlockedEpisodes) || '[]');
let currentlyCountingDownEpisodeId = null; // Track episode currently showing a timer
let activeTimers = {}; // Stores setInterval IDs for active timers
let episodeDataStore = {}; // To store all fetched episode data for easy access

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

function playEpisode(url) {
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

    if (playerInitialMessage) {
        playerInitialMessage.style.display = 'none';
    }
    videoDisplayArea.style.display = 'block';
    videoDisplayArea.innerHTML = ''; // Clear previous content

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
        videoElement.setAttribute('autoplay', ''); // Attempt autoplay
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
}

// --- Ad and Unlock Logic ---

function attemptUnlock(episodeId, episodeTitle) {
    if (unlockedEpisodeIds.includes(episodeId)) {
        playEpisode(episodeDataStore[episodeId].url);
        return;
    }

    // Prevent multiple countdowns at once
    if (currentlyCountingDownEpisodeId && currentlyCountingDownEpisodeId !== episodeId) {
        alert("Please wait for the current episode to unlock or refresh the page.");
        return;
    }
    if (activeTimers[episodeId]) { // If timer already active for THIS episode
        console.log("Timer already active for this episode.");
        return;
    }

    currentlyCountingDownEpisodeId = episodeId;

    // Find the specific button for this episode
    const episodeButton = document.querySelector(`.episode-btn[data-episode-id="${episodeId}"]`);
    if (!episodeButton) {
        console.error("Could not find episode button for ID:", episodeId);
        alert("An error occurred. Please try again or refresh the page.");
        currentlyCountingDownEpisodeId = null;
        return;
    }

    // Disable the button to prevent multiple clicks during countdown
    episodeButton.disabled = true;

    let timeLeft = adWatchTime / 1000;
    episodeButton.innerHTML = `${episodeTitle} <span class="lock-icon">🔒 (<span class="timer">${timeLeft}s</span>)</span>`;

    const adWindow = window.open(adUrl, '_blank');
    if (!adWindow) {
        alert("Pop-up blocked! Please allow pop-ups for this site to watch the ad and unlock the episode.");
        updatePlayerMessage("Pop-up blocked. Allow pop-ups to watch ad.", true);
        episodeButton.disabled = false; // Re-enable button
        episodeButton.innerHTML = `${episodeTitle} <span class="lock-icon">🔒</span>`; // Reset text
        currentlyCountingDownEpisodeId = null;
        return;
    }

    // Start countdown on the button
    activeTimers[episodeId] = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) {
            episodeButton.innerHTML = `${episodeTitle} <span class="lock-icon">🔒 (<span class="timer">${timeLeft}s</span>)</span>`;
        } else {
            clearInterval(activeTimers[episodeId]);
            delete activeTimers[episodeId]; // Remove from active timers
            finishAdWatching(episodeId, adWindow); // Pass adWindow to close it
        }
    }, 1000);
}

function finishAdWatching(episodeId, adWindow = null) {
    if (currentlyCountingDownEpisodeId === episodeId) {
        // Add to unlocked list
        unlockedEpisodeIds.push(episodeId);
        localStorage.setItem(localStorageKey_UnlockedEpisodes, JSON.stringify(unlockedEpisodeIds));

        alert(`"${episodeDataStore[episodeId].title}" unlocked! Playing now.`);

        // Attempt to close the ad tab if it's still open
        if (adWindow && !adWindow.closed) {
            try {
                adWindow.close();
            } catch (e) {
                console.warn("Could not close ad window:", e);
                // alert("Please manually close the ad tab to continue."); // Can be annoying, use sparingly
            }
        }

        currentlyCountingDownEpisodeId = null; // Reset

        // Re-render episode list to update button state and play the episode
        loadEpisodesRealtime(true, episodeId); // Pass episodeId to play it
    }
}

// --- Real-time Data Loading ---
// Added optional parameters for playing a specific episode after unlock
function loadEpisodesRealtime(playAfterUnlock = false, unlockedEpisodeIdToPlay = null) {
    // Clear any active timers before re-rendering the list
    for (const timerId in activeTimers) {
        clearInterval(activeTimers[timerId]);
        delete activeTimers[timerId];
    }
    currentlyCountingDownEpisodeId = null; // Reset current countdown

    db.ref('episodes').on('value', function(snapshot) {
        console.log("Firebase snapshot received:", snapshot.val());
        const episodesData = snapshot.val();
        window.episodeDataStore = episodesData; // Store globally for easy access
        let episodesListHtml = '';
        let firstEpisodeUrl = null;
        const episodeKeys = episodesData ? Object.keys(episodesData) : [];

        if (episodeKeys.length > 0) {
            const firstEpisodeKey = episodeKeys[0];
            firstEpisodeUrl = episodesData[firstEpisodeKey]?.url;

            episodeKeys.forEach(episodeId => {
                const episode = episodesData[episodeId];
                if (episode && typeof episode.title === 'string' && typeof episode.url === 'string' && episode.title.trim() !== '' && episode.url.trim() !== '') {
                    const escapedTitle = episode.title.replace(/'/g, "\\'");
                    const escapedUrl = episode.url.replace(/'/g, "\\'");
                    
                    // Each button needs a unique data-episode-id for easy lookup
                    const buttonAttributes = `class="episode-btn" data-episode-id="${episodeId}"`;

                    if (episode.isFree || unlockedEpisodeIds.includes(episodeId)) {
                        episodesListHtml += `
                            <div class="episode-container">
                                <button ${buttonAttributes} onclick="playEpisode('${escapedUrl}')">${episode.title}</button>
                            </div>
                        `;
                    } else {
                        // Locked non-free episode, requires ad to unlock
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
            });
            if (currentlyCountingDownEpisodeId === null && videoDisplayArea.style.display !== 'block') {
                updatePlayerMessage("Select an Episode to Play", false);
            }
        } else {
            episodesListHtml = '<p class="no-episodes-message">No episodes available. Please add some from the Admin Panel.</p>';
            updatePlayerMessage("No episodes to play.", false);
        }

        episodeListDiv.innerHTML = episodesListHtml;

        // Auto-play the first episode OR the newly unlocked episode
        if (playAfterUnlock && unlockedEpisodeIdToPlay && episodeDataStore[unlockedEpisodeIdToPlay]) {
            playEpisode(episodeDataStore[unlockedEpisodeIdToPlay].url);
        } else if (!playAfterUnlock && firstEpisodeUrl && videoDisplayArea.innerHTML === '') {
            playEpisode(firstEpisodeUrl);
        }

    }, function(error) {
        console.error("Firebase read error:", error);
        episodeListDiv.innerHTML = '<p class="no-episodes-message" style="color:#dc3545;">Error loading episodes: ' + error.message + '</p>';
        updatePlayerMessage("Error loading episodes. Check console for details.", true);
    });
}

// Initial setup on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    updatePlayerMessage("Loading episodes...", false);
    loadEpisodesRealtime(); // Initial load
});
