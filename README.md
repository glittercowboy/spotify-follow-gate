# Spotify Follow Gate

This application implements a Spotify OAuth flow that verifies if users are following a specific artist.

## Setup

1. Create a Spotify Developer account and register your application at https://developer.spotify.com/dashboard
2. Set your application's redirect URI to `https://taches.io/callback`
3. Copy your Client ID and Client Secret from the Spotify Dashboard
4. Update the `.env` file with your credentials:
   ```
   CLIENT_ID=your_spotify_client_id
   CLIENT_SECRET=your_spotify_client_secret
   ```

## Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the server:
   ```bash
   npm start
   ```

The server will run on port 3000 by default.

## How it Works

1. Users click "Login with Spotify" to initiate the OAuth flow
2. After authentication, the app checks if the user follows the specified artist
3. Access is granted only if the user follows the artist
4. If not following, users are provided with a link to follow the artist
