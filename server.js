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
const SUCCESS_REDIRECT_URL = process.env.SUCCESS_REDIRECT_URL;
const FAILURE_REDIRECT_URL = process.env.FAILURE_REDIRECT_URL;

// Spotify OAuth endpoints
const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_URL = 'https://api.spotify.com/v1';

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
    const scope = 'user-follow-read user-follow-modify';
    const state = Math.random().toString(36).substring(7);
    
    // Set cookie with proper options
    res.cookie('spotify_auth_state', state, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 3600000 // 1 hour
    });
    
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        scope: scope,
        redirect_uri: REDIRECT_URI,
        state: state,
        show_dialog: false // Changed to false to prevent endless loop
    });

    res.redirect(`${SPOTIFY_AUTH_URL}?${params.toString()}`);
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

        // Then verify artist exists
        const artistResponse = await axios.get(`${SPOTIFY_API_URL}/artists/${ARTIST_ID}`, {
            headers: {
                'Authorization': `Bearer ${access_token}`
            }
        });
        console.log('Artist found:', artistResponse.data.name);

        // Follow the artist
        console.log('Attempting to follow artist...');
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

        // Verify the follow was successful
        const verifyFollow = await axios.get(`${SPOTIFY_API_URL}/me/following/contains`, {
            params: {
                type: 'artist',
                ids: ARTIST_ID
            },
            headers: {
                'Authorization': `Bearer ${access_token}`
            }
        });

        if (verifyFollow.data[0]) {
            console.log('Follow verified successfully');
            res.json({ success: true });
        } else {
            console.error('Follow appeared to succeed but verification failed');
            res.status(500).json({ 
                error: 'Failed to verify follow',
                details: 'The follow request succeeded but verification failed. Please try again or follow manually.'
            });
        }
    } catch (error) {
        console.error('Follow error:', {
            endpoint: error.config?.url,
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
        });

        let errorMessage = 'Failed to follow artist. ';
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
            error: 'Failed to follow artist',
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
            artistId: ARTIST_ID
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

        // First, verify the artist exists
        try {
            console.log('Starting artist verification...');
            console.log('Artist ID to verify:', ARTIST_ID);
            console.log('Making request to:', `${SPOTIFY_API_URL}/artists/${ARTIST_ID}`);
            
            const artistResponse = await axios.get(`${SPOTIFY_API_URL}/artists/${ARTIST_ID}`, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            
            console.log('Artist verification successful:', {
                name: artistResponse.data.name,
                id: artistResponse.data.id,
                uri: artistResponse.data.uri
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

        // Check if user follows the artist
        console.log('Checking follow status for artist:', ARTIST_ID);
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
        console.log('Follow status:', isFollowing);

        if (isFollowing) {
            console.log('User follows artist, redirecting to:', SUCCESS_REDIRECT_URL);
            res.redirect(SUCCESS_REDIRECT_URL);
        } else {
            // Show follow page with error handling
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Follow to Continue</title>
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
                        .button {
                            display: inline-block;
                            background: #1DB954;
                            color: white;
                            padding: 15px 30px;
                            border-radius: 25px;
                            text-decoration: none;
                            font-weight: bold;
                            transition: background 0.3s;
                            border: none;
                            cursor: pointer;
                            margin: 10px;
                        }
                        .button:hover {
                            background: #1ed760;
                        }
                        .message {
                            margin: 20px 0;
                            padding: 10px;
                        }
                        #status {
                            margin-top: 20px;
                            font-weight: bold;
                        }
                    </style>
                </head>
                <body>
                    <h1>One More Step!</h1>
                    <p>To access the download, please follow the artist on Spotify.</p>
                    <button onclick="followArtist()" class="button">Follow Artist</button>
                    <a href="https://open.spotify.com/artist/${ARTIST_ID}" target="_blank" class="button">Open in Spotify</a>
                    <a href="/login" class="button">Check Again</a>
                    <div id="status"></div>
                    <div id="error" style="color: #ff4444; margin-top: 20px;"></div>

                    <script>
                    async function followArtist() {
                        const status = document.getElementById('status');
                        const error = document.getElementById('error');
                        status.textContent = 'Following artist...';
                        error.textContent = '';
                        
                        try {
                            const response = await fetch('/follow?access_token=${accessToken}');
                            if (!response.ok) {
                                const errorData = await response.json();
                                throw new Error(errorData.details || errorData.error || 'Failed to follow artist');
                            }
                            const data = await response.json();
                            
                            if (data.success) {
                                status.textContent = 'Successfully followed! Redirecting...';
                                error.textContent = '';
                                setTimeout(() => {
                                    window.location.href = '/login';
                                }, 1500);
                            } else {
                                throw new Error(data.error || 'Failed to follow');
                            }
                        } catch (err) {
                            console.error('Follow error:', err);
                            status.textContent = '';
                            error.textContent = 'Error: ' + err.message;
                            // Add retry button
                            error.innerHTML += '<br><br><button onclick="followArtist()" class="button">Try Again</button>';
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
