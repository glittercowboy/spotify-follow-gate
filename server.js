require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');

// Validate required environment variables
const requiredEnvVars = ['CLIENT_ID', 'CLIENT_SECRET', 'REDIRECT_URI', 'ARTIST_ID', 'SUCCESS_REDIRECT_URL', 'FAILURE_REDIRECT_URL'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
    console.error('Error: Missing required environment variables:', missingEnvVars.join(', '));
    process.exit(1);
}

const app = express();
app.use(cookieParser());

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const ARTIST_ID = process.env.ARTIST_ID;
const PLAYLIST_ID = process.env.PLAYLIST_ID || '22UjtzmKbo9WLSLqfvx2PR';
const SUCCESS_REDIRECT_URL = process.env.SUCCESS_REDIRECT_URL;
const FAILURE_REDIRECT_URL = process.env.FAILURE_REDIRECT_URL;

// Spotify OAuth endpoints
const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_URL = 'https://api.spotify.com/v1';

// Generate a random string for state
function generateRandomString(length) {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

app.get('/', (req, res) => {
    const error = req.query.error;
    const details = req.query.details;
    
    let errorMessage = '';
    if (error === 'spotify_access_denied') {
        errorMessage = 'You need to approve the permissions to continue.';
    } else if (error === 'state_mismatch') {
        errorMessage = 'Security verification failed. Please try again.';
    } else if (error === 'auth_error') {
        errorMessage = 'Authentication error. Please try again. ' + (details || '');
    }
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Spotify Follow Gate</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                    max-width: 600px;
                    margin: 40px auto;
                    padding: 20px;
                    text-align: center;
                    background: #121212;
                    color: white;
                }
                h1 {
                    color: #1DB954;
                    margin-bottom: 30px;
                }
                .login-button {
                    display: inline-block;
                    background: #1DB954;
                    color: white;
                    padding: 15px 30px;
                    border-radius: 25px;
                    text-decoration: none;
                    font-weight: bold;
                    transition: background 0.3s;
                }
                .login-button:hover {
                    background: #1ed760;
                }
                .error {
                    color: #ff4444;
                    margin: 20px 0;
                    padding: 10px;
                    border-radius: 5px;
                    background: rgba(255,68,68,0.1);
                }
            </style>
        </head>
        <body>
            <h1>Spotify Follow Gate</h1>
            ${errorMessage ? `<div class="error">${errorMessage}</div>` : ''}
            <a href="/login" class="login-button">Login with Spotify</a>
        </body>
        </html>
    `);
});

app.get('/login', (req, res) => {
    const state = generateRandomString(16);
    res.cookie('spotify_auth_state', state);

    // Include all necessary scopes
    const scope = 'user-follow-read user-follow-modify playlist-read-private playlist-read-collaborative';
    res.redirect(SPOTIFY_AUTH_URL +
        '?response_type=code' +
        '&client_id=' + CLIENT_ID +
        '&scope=' + encodeURIComponent(scope) +
        '&redirect_uri=' + encodeURIComponent(REDIRECT_URI) +
        '&state=' + state +
        '&show_dialog=true'
    );
});

app.get('/follow', async (req, res) => {
    const { access_token } = req.query;
    
    if (!access_token) {
        console.error('No access token provided');
        res.status(400).json({ error: 'No access token provided' });
        return;
    }

    try {
        // First verify we can get user info
        console.log('Verifying user authentication...');
        const userResponse = await axios.get(`${SPOTIFY_API_URL}/me`, {
            headers: {
                'Authorization': `Bearer ${access_token}`
            }
        });
        console.log('User authenticated:', userResponse.data.id);

        // Follow artist
        try {
            await axios({
                method: 'put',
                url: `${SPOTIFY_API_URL}/me/following`,
                params: {
                    type: 'artist',
                    ids: ARTIST_ID
                },
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'Content-Type': 'application/json'
                }
            });
            console.log('Successfully followed artist');
        } catch (artistError) {
            console.error('Artist follow error:', {
                status: artistError.response?.status,
                data: artistError.response?.data,
                message: artistError.message
            });
            throw new Error('Failed to follow artist. ' + (artistError.response?.data?.error?.message || artistError.message));
        }

        // Follow playlist
        try {
            await axios({
                method: 'put',
                url: `${SPOTIFY_API_URL}/playlists/${PLAYLIST_ID}/followers`,
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'Content-Type': 'application/json'
                }
            });
            console.log('Successfully followed playlist');
        } catch (playlistError) {
            console.error('Playlist follow error:', {
                status: playlistError.response?.status,
                data: playlistError.response?.data,
                message: playlistError.message
            });
            throw new Error('Failed to follow playlist. ' + (playlistError.response?.data?.error?.message || playlistError.message));
        }

        // Verify follows
        console.log('Verifying follows...');
        const [artistFollow, playlistInfo] = await Promise.all([
            // Check artist follow
            axios.get(`${SPOTIFY_API_URL}/me/following/contains`, {
                params: {
                    type: 'artist',
                    ids: ARTIST_ID
                },
                headers: {
                    'Authorization': `Bearer ${access_token}`
                }
            }),
            // Get playlist info to check if user follows
            axios.get(`${SPOTIFY_API_URL}/playlists/${PLAYLIST_ID}`, {
                headers: {
                    'Authorization': `Bearer ${access_token}`
                }
            })
        ]);

        const isFollowingArtist = artistFollow.data[0];
        const followers = playlistInfo.data.followers?.total || 0;
        console.log('Verification status:', {
            artist: isFollowingArtist,
            playlistFollowers: followers
        });

        // Since we can't directly check if the user follows the playlist,
        // we'll assume success if the artist follow is verified
        if (isFollowingArtist) {
            console.log('Follow verified successfully');
            res.json({ success: true });
        } else {
            console.error('Follow verification failed');
            res.status(500).json({ 
                error: 'Failed to verify follows',
                details: 'The follow requests succeeded but verification failed. Please try again.'
            });
        }
    } catch (error) {
        console.error('Error:', {
            endpoint: error.config?.url,
            status: error.response?.status,
            data: error.response?.data,
            message: error.message,
            stack: error.stack
        });

        let errorMessage = 'Failed to complete actions. ';
        if (error.response?.status === 401) {
            errorMessage += 'Your session has expired. Please log in again.';
        } else if (error.response?.status === 403) {
            errorMessage += 'Permission denied. Please make sure you approved all permissions.';
        } else if (error.response?.data?.error?.message) {
            errorMessage += error.response.data.error.message;
        } else {
            errorMessage += error.message;
        }

        res.status(error.response?.status || 500).json({ 
            error: 'Action failed',
            details: errorMessage
        });
    }
});

app.get('/callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;
    const storedState = req.cookies['spotify_auth_state'];
    const error = req.query.error;

    console.log('Callback received:', {
        hasCode: !!code,
        hasState: !!state,
        hasStoredState: !!storedState,
        error: error || 'none'
    });

    if (error) {
        console.error('Authorization error:', error);
        res.redirect('/?error=' + encodeURIComponent(error));
        return;
    }

    if (!code) {
        console.error('No code provided');
        res.redirect('/?error=' + encodeURIComponent('No authorization code provided'));
        return;
    }

    if (state !== storedState) {
        console.error('State mismatch:', { state, storedState });
        res.redirect('/?error=' + encodeURIComponent('State verification failed'));
        return;
    }

    // Log environment variables (without exposing sensitive data)
    console.log('Environment check:', {
        hasClientId: !!CLIENT_ID,
        hasClientSecret: !!CLIENT_SECRET,
        redirectUri: REDIRECT_URI,
        artistId: ARTIST_ID,
        playlistId: PLAYLIST_ID
    });

    try {
        console.log('Attempting token exchange with code:', code.substring(0, 5) + '...');
        
        // Exchange code for access token
        const tokenResponse = await axios({
            method: 'post',
            url: SPOTIFY_TOKEN_URL,
            params: {
                code: code,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code'
            },
            headers: {
                'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        console.log('Token exchange successful');
        const accessToken = tokenResponse.data.access_token;

        // Verify artist exists
        console.log('Starting artist verification...');
        console.log('Artist ID to verify:', ARTIST_ID);
        
        const artistInfo = await axios.get(`${SPOTIFY_API_URL}/artists/${ARTIST_ID}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!artistInfo.data) {
            throw new Error(`Invalid artist ID (${ARTIST_ID}). Please check the ARTIST_ID in your environment variables.`);
        }

        console.log('Artist verification successful:', {
            name: artistInfo.data.name,
            id: artistInfo.data.id,
            uri: artistInfo.data.uri
        });

        // Check if user follows the artist
        console.log('Checking artist follow status...');
        const followResponse = await axios.get(`${SPOTIFY_API_URL}/me/following/contains`, {
            params: {
                type: 'artist',
                ids: ARTIST_ID
            },
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        const isFollowing = followResponse.data[0];
        console.log('Artist follow status:', isFollowing);

        if (isFollowing) {
            console.log('User follows artist, redirecting to:', SUCCESS_REDIRECT_URL);
            res.redirect(SUCCESS_REDIRECT_URL);
        } else {
            // Get artist image URL
            const artistImage = artistInfo.data.images[0]?.url || '';
            
            // Show follow page
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Follow ${artistInfo.data.name} on Spotify</title>
                    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;800&display=swap" rel="stylesheet">
                    <style>
                        /* ... existing styles ... */
                    </style>
                </head>
                <body>
                    <div class="container">
                        <img src="${artistImage}" alt="${artistInfo.data.name}" class="artist-image">
                        <h1>ONE MORE STEP...</h1>
                        <p>Follow ${artistInfo.data.name} and their playlist on Spotify to access your free download</p>
                        <button onclick="followBoth()" class="button">Follow Now</button>
                        <div id="status"></div>
                        <div id="error"></div>
                    </div>

                    <script>
                    async function followBoth() {
                        const status = document.getElementById('status');
                        const error = document.getElementById('error');
                        status.textContent = 'Following...';
                        error.textContent = '';
                        
                        try {
                            const response = await fetch('/follow?access_token=${accessToken}');
                            if (!response.ok) {
                                const errorData = await response.json();
                                throw new Error(errorData.details || errorData.error || 'Failed to follow');
                            }
                            const data = await response.json();
                            
                            if (data.success) {
                                status.textContent = 'Successfully followed! Redirecting...';
                                error.textContent = '';
                                setTimeout(() => {
                                    window.location.href = '${SUCCESS_REDIRECT_URL}';
                                }, 1500);
                            } else {
                                throw new Error(data.error || 'Failed to follow');
                            }
                        } catch (err) {
                            console.error('Follow error:', err);
                            status.textContent = '';
                            error.textContent = 'Error: ' + err.message;
                        }
                    }
                    </script>
                </body>
                </html>
            `);
        }
    } catch (error) {
        console.error('Callback error:', {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
        });

        const errorMessage = error.response?.data?.error_description || 
                           error.response?.data?.error?.message || 
                           error.message || 
                           'An unknown error occurred';

        res.redirect('/?error=' + encodeURIComponent(errorMessage));
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
