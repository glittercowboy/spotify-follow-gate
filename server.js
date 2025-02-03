require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');

// Validate required environment variables
const requiredEnvVars = ['CLIENT_ID', 'CLIENT_SECRET', 'REDIRECT_URI', 'ARTIST_ID', 'PLAYLIST_ID', 'SUCCESS_REDIRECT_URL', 'FAILURE_REDIRECT_URL'];
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

    const scope = 'user-follow-read user-follow-modify playlist-modify-public';
    res.redirect(SPOTIFY_AUTH_URL +
        '?response_type=code' +
        '&client_id=' + CLIENT_ID +
        '&scope=' + encodeURIComponent(scope) +
        '&redirect_uri=' + encodeURIComponent(REDIRECT_URI) +
        '&state=' + state
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
        const userResponse = await axios.get(`${SPOTIFY_API_URL}/me`, {
            headers: {
                'Authorization': `Bearer ${access_token}`
            }
        });
        console.log('User authenticated:', userResponse.data.id);

        // Follow both artist and playlist
        console.log('Attempting to follow artist and playlist...');
        
        // Follow artist
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

        // Follow playlist
        await axios({
            method: 'put',
            url: `${SPOTIFY_API_URL}/playlists/${PLAYLIST_ID}/followers`,
            headers: {
                'Authorization': `Bearer ${access_token}`,
                'Content-Type': 'application/json'
            }
        });
        console.log('Successfully followed playlist');

        // Verify both follows
        const [artistFollow, playlistFollow] = await Promise.all([
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
            // Check playlist follow
            axios.get(`${SPOTIFY_API_URL}/playlists/${PLAYLIST_ID}/followers/contains`, {
                params: {
                    ids: userResponse.data.id
                },
                headers: {
                    'Authorization': `Bearer ${access_token}`
                }
            })
        ]);

        if (artistFollow.data[0] && playlistFollow.data[0]) {
            console.log('Both follows verified successfully');
            res.json({ success: true });
        } else {
            console.error('Follow verification failed');
            res.status(500).json({ 
                error: 'Failed to verify follows',
                details: 'The follow requests succeeded but verification failed. Please try again.'
            });
        }
    } catch (error) {
        console.error('Follow error:', {
            endpoint: error.config?.url,
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
        });

        let errorMessage = 'Failed to follow. ';
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
            error: 'Failed to follow',
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

    // Clear the state cookie
    res.clearCookie('spotify_auth_state');

    // Handle Spotify errors
    if (error) {
        console.error('Spotify auth error:', error);
        res.redirect(`/?error=spotify_${error}`);
        return;
    }

    if (!state || !storedState || state !== storedState) {
        console.error('State mismatch:', { state, storedState });
        res.redirect('/?error=state_mismatch');
        return;
    }

    try {
        console.log('Environment check:', {
            hasClientId: !!CLIENT_ID,
            hasClientSecret: !!CLIENT_SECRET,
            redirectUri: REDIRECT_URI,
            artistId: ARTIST_ID,
            playlistId: PLAYLIST_ID
        });

        console.log('Attempting token exchange with code:', code.substring(0, 5) + '...');
        
        // Exchange code for access token
        const tokenResponse = await axios.post(SPOTIFY_TOKEN_URL, 
            new URLSearchParams({
                code: code,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code'
            }), {
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'),
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        console.log('Token exchange successful');
        const accessToken = tokenResponse.data.access_token;

        // First, verify the artist exists and get artist info
        let artistInfo;
        try {
            console.log('Starting artist verification...');
            console.log('Artist ID to verify:', ARTIST_ID);
            console.log('Making request to:', `${SPOTIFY_API_URL}/artists/${ARTIST_ID}`);
            
            const artistResponse = await axios.get(`${SPOTIFY_API_URL}/artists/${ARTIST_ID}`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            
            artistInfo = artistResponse.data;
            console.log('Artist verification successful:', {
                name: artistInfo.name,
                id: artistInfo.id,
                uri: artistInfo.uri
            });
        } catch (artistError) {
            console.error('Artist verification failed:', {
                status: artistError.response?.status,
                statusText: artistError.response?.statusText,
                data: artistError.response?.data,
                message: artistError.message,
                artistId: ARTIST_ID,
                url: artistError.config?.url
            });
            throw new Error(`Invalid artist ID (${ARTIST_ID}). Please check the ARTIST_ID in your environment variables.`);
        }

        // Check if user follows both artist and playlist
        console.log('Checking follow status...');
        const [artistFollow, playlistFollow] = await Promise.all([
            // Check artist follow
            axios.get(`${SPOTIFY_API_URL}/me/following/contains`, {
                params: {
                    type: 'artist',
                    ids: ARTIST_ID
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            }),
            // Check playlist follow
            axios.get(`${SPOTIFY_API_URL}/playlists/${PLAYLIST_ID}/followers/contains`, {
                params: {
                    ids: artistInfo.id
                },
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            })
        ]);

        const isFollowingArtist = artistFollow.data[0];
        const isFollowingPlaylist = playlistFollow.data[0];
        console.log('Follow status:', { artist: isFollowingArtist, playlist: isFollowingPlaylist });

        if (isFollowingArtist && isFollowingPlaylist) {
            console.log('User follows both, redirecting to:', SUCCESS_REDIRECT_URL);
            res.redirect(SUCCESS_REDIRECT_URL);
        } else {
            // Get artist image URL and playlist info
            const artistImage = artistInfo.images[0]?.url || '';
            const playlistResponse = await axios.get(`${SPOTIFY_API_URL}/playlists/${PLAYLIST_ID}`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            const playlistName = playlistResponse.data.name;
            
            // Show follow page with improved design
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Follow ${artistInfo.name} on Spotify</title>
                    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;800&display=swap" rel="stylesheet">
                    <style>
                        body {
                            margin: 0;
                            padding: 0;
                            min-height: 100vh;
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            justify-content: center;
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                            background: #000000;
                            color: white;
                            text-align: center;
                        }
                        .container {
                            padding: 2rem;
                            max-width: 800px;
                            width: 90%;
                        }
                        h1 {
                            font-family: 'Poppins', sans-serif;
                            font-weight: 800;
                            font-size: 3rem;
                            margin-bottom: 1.5rem;
                            color: white;
                            text-transform: uppercase;
                            letter-spacing: 2px;
                        }
                        p {
                            font-size: 1.4rem;
                            margin-bottom: 2.5rem;
                            color: rgba(255, 255, 255, 0.9);
                            font-family: 'Poppins', sans-serif;
                            font-weight: 400;
                            line-height: 1.6;
                        }
                        .artist-image {
                            width: 500px;
                            height: 500px;
                            margin-bottom: 2.5rem;
                            box-shadow: 0 8px 24px rgba(0,0,0,0.2);
                        }
                        .button {
                            background: #1DB954;
                            color: white;
                            border: none;
                            padding: 1.2rem 3rem;
                            font-size: 1.2rem;
                            font-weight: 600;
                            cursor: pointer;
                            text-decoration: none;
                            display: inline-block;
                            transition: transform 0.2s, background-color 0.2s;
                            text-transform: uppercase;
                            letter-spacing: 1px;
                            font-family: 'Poppins', sans-serif;
                        }
                        .button:hover {
                            background: #1ed760;
                            transform: translateY(-2px);
                        }
                        #status {
                            margin-top: 1.5rem;
                            font-weight: 500;
                            color: white;
                            font-family: 'Poppins', sans-serif;
                        }
                        #error {
                            margin-top: 1rem;
                            color: #ff4444;
                            font-weight: 500;
                            font-family: 'Poppins', sans-serif;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <img src="${artistImage}" alt="${artistInfo.name}" class="artist-image">
                        <h1>ONE MORE STEP...</h1>
                        <p>Follow ${artistInfo.name} and their playlist "${playlistName}" on Spotify to access your free download</p>
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
        console.error('Auth error details:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            message: error.message,
            config: {
                url: error.config?.url,
                method: error.config?.method,
                headers: {
                    ...error.config?.headers,
                    Authorization: error.config?.headers?.Authorization ? '[REDACTED]' : undefined
                }
            }
        });

        let errorMessage = 'Authentication failed. ';
        if (error.message.includes('Invalid artist ID')) {
            errorMessage = error.message;
        } else if (error.response?.status === 403) {
            errorMessage += 'Please make sure you are using the correct Spotify account and try again.';
        } else if (error.response?.data?.error_description) {
            errorMessage += error.response.data.error_description;
        } else {
            errorMessage += error.message;
        }

        res.redirect('/?error=auth_error&details=' + encodeURIComponent(errorMessage));
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
