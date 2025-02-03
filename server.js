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
        // Follow the artist
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

        res.json({ success: true });
    } catch (error) {
        console.error('Follow error:', {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
        });
        res.status(500).json({ 
            error: 'Failed to follow artist',
            details: error.response?.data || error.message 
        });
    }
});

app.get('/callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;
    const storedState = req.cookies['spotify_auth_state'];
    const error = req.query.error;

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

        const accessToken = tokenResponse.data.access_token;

        // Check if user follows the artist
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

        if (isFollowing) {
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
                    <a href="/login" class="button">Check Again</a>
                    <div id="status"></div>
                    <div id="error" style="color: #ff4444; margin-top: 20px;"></div>

                    <script>
                    // Add error handling for fetch
                    function handleErrors(response) {
                        if (!response.ok) {
                            return response.json().then(err => {
                                throw new Error(err.details || err.error || 'Network response was not ok');
                            });
                        }
                        return response.json();
                    }

                    async function followArtist() {
                        const status = document.getElementById('status');
                        const error = document.getElementById('error');
                        status.textContent = 'Following artist...';
                        error.textContent = '';
                        
                        try {
                            const response = await fetch('/follow?access_token=${accessToken}');
                            const data = await handleErrors(response);
                            
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
                        }
                    }
                    </script>
                </body>
                </html>
            `);
        }

    } catch (error) {
        console.error('Auth error:', {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
        });
        res.redirect('/?error=auth_error&details=' + encodeURIComponent(error.message));
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
