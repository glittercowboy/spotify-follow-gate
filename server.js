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
    res.send(`
        <h1>Spotify Follow Gate</h1>
        <a href="/login">Login with Spotify</a>
    `);
});

app.get('/login', (req, res) => {
    const scope = 'user-follow-read';
    const state = Math.random().toString(36).substring(7);
    
    res.cookie('spotify_auth_state', state);
    
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        scope: scope,
        redirect_uri: REDIRECT_URI,
        state: state
    });

    res.redirect(`${SPOTIFY_AUTH_URL}?${params.toString()}`);
});

app.get('/callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;
    const storedState = req.cookies['spotify_auth_state'];

    if (state === null || state !== storedState) {
        res.redirect(FAILURE_REDIRECT_URL);
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
            // Redirect to GoHighLevel download page
            res.redirect(SUCCESS_REDIRECT_URL);
        } else {
            // Redirect to GoHighLevel "please follow" page
            res.redirect(FAILURE_REDIRECT_URL);
        }

    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
        res.redirect(FAILURE_REDIRECT_URL);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
