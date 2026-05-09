# GymTrack

A comprehensive Progressive Web App (PWA) for serious gym progress tracking, designed for hypertrophy and strength lifters. Features offline-first logging, deterministic insights, AI-powered weekly digests, and adaptive mesocycle automation.

## Overview

GymTrack is built with a modern stack:
- **Frontend**: React 19 with Tailwind CSS, shadcn/ui components, and Recharts for data visualization
- **Backend**: FastAPI with MongoDB (via Motor), Google OAuth authentication, and Claude LLM integration
- **Features**: Workout logging, exercise recommendations, plateau detection, recovery tracking, mesocycle planning, and AI insights

## Key Features

- **Fast, Mobile-First Logging**: One-thumb UX with offline support
- **Intelligent Recommendations**: Progression suggestions based on performance and recovery
- **Plateau Detection**: Automatic identification of stagnation points
- **Mesocycle Automation**: Auto-generated programs with deload weeks and redistribution
- **AI Insights**: Weekly digests powered by Claude Sonnet 4.5
- **PWA**: Installable app with service worker caching and offline queue
- **Advanced Logging**: Support for warmup sets, dropsets, myo-reps, clusters, and time-based sets

## Project Structure

```
GymTrack/
├── backend/                 # FastAPI backend
│   ├── server.py           # Main API server
│   ├── services.py         # Business logic and recommendations
│   ├── seeds.py            # Exercise data and system splits
│   ├── requirements.txt    # Python dependencies
│   └── tests/              # Backend tests
├── frontend/                # React frontend
│   ├── src/
│   │   ├── components/     # Reusable UI components
│   │   ├── pages/          # Page components
│   │   ├── lib/            # Utilities and API client
│   │   └── hooks/          # Custom React hooks
│   ├── public/             # Static assets and PWA files
│   └── package.json        # Node dependencies
├── memory/                 # Project documentation
│   └── PRD.md             # Product Requirements Document
└── tests/                  # Integration tests
```

## Prerequisites

- Python 3.8+
- Node.js 16+
- MongoDB (local or cloud instance)
- Google OAuth credentials
- Groq API key (for AI-powered weekly digests)

## Environment Setup

### Backend (.env in project root)

Create a `.env` file in the project root with the following variables:

```env
MONGO_URL=mongodb://localhost:27017
DB_NAME=gymtrack
GROQ_API_KEY=your_groq_api_key
CORS_ORIGINS=http://localhost:3000
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
JWT_SECRET=your_jwt_secret_key
```

### Frontend (.env in frontend/ directory)

Create a `.env` file in the `frontend/` directory:

```env
REACT_APP_BACKEND_URL=http://localhost:8000
```

## Installation & Setup

### Backend

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Ensure MongoDB is running locally or update `MONGO_URL` for cloud instance.

4. Run the backend server:
   ```bash
   uvicorn server:app --reload --host 0.0.0.0 --port 8000
   ```

The API will be available at `http://localhost:8000`.

### Frontend

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install Node dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm start
   ```

The app will be available at `http://localhost:3000`.

## Testing

### Backend Tests

```bash
cd backend
pytest tests/
```

### Frontend Tests

```bash
cd frontend
npm test
```

## Deployment

GymTrack can be deployed using various cloud platforms. Here are recommended options for different hosting scenarios.

### Quick Deployment (Recommended for Beginners)

#### Option 1: Railway (Full-stack)
Railway provides easy deployment for both frontend and backend with built-in databases.

1. **Database**: Use Railway's MongoDB or connect to MongoDB Atlas
2. **Backend**: Deploy FastAPI to Railway
3. **Frontend**: Deploy React app to Railway or Vercel

#### Option 2: Render (Full-stack)
Render supports web services and static sites.

1. **Database**: MongoDB Atlas
2. **Backend**: Create a Web Service with Python runtime
3. **Frontend**: Create a Static Site

### Detailed Deployment Steps

#### 1. Database Setup (MongoDB Atlas)

1. Create account at [MongoDB Atlas](https://www.mongodb.com/atlas)
2. Create a free cluster
3. Set up database user and IP whitelist
4. Get connection string: `mongodb+srv://username:password@cluster.mongodb.net/dbname`

#### 2. Backend Deployment

**Environment Variables for Production:**
```env
MONGO_URL=mongodb+srv://username:password@cluster.mongodb.net/dbname
DB_NAME=gymtrack
GROQ_API_KEY=your_groq_api_key
CORS_ORIGINS=https://your-frontend-domain.com
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
JWT_SECRET=your_secure_random_jwt_secret
```

**Railway Deployment:**
1. Connect GitHub repo to Railway
2. Set environment variables in Railway dashboard
3. Deploy - Railway auto-detects Python and installs requirements.txt
4. Get the backend URL (e.g., `https://gymtrack-backend.railway.app`)

**Render Deployment:**
1. Create new Web Service from Git
2. Set build command: `pip install -r requirements.txt`
3. Set start command: `uvicorn server:app --host 0.0.0.0 --port $PORT`
4. Add environment variables
5. Deploy

**Heroku Deployment:**
1. Install Heroku CLI
2. Create app: `heroku create gymtrack-backend`
3. Set environment variables: `heroku config:set MONGO_URL=...`
4. Deploy: `git push heroku main`

#### 3. Frontend Deployment

**Build for Production:**
```bash
cd frontend
npm run build
```

This creates a `build/` directory with optimized static files.

**Environment Variables for Production:**
Update `frontend/.env`:
```env
REACT_APP_BACKEND_URL=https://your-backend-url.com
```

**Vercel Deployment (Recommended):**
1. Install Vercel CLI: `npm i -g vercel`
2. From frontend directory: `vercel`
3. Set environment variable: `REACT_APP_BACKEND_URL=https://your-backend-url.com`
4. Deploy

**Netlify Deployment:**
1. Drag & drop the `build/` folder to Netlify dashboard
2. Set environment variable in site settings
3. Deploy

**Railway Static Site:**
1. Create Static Site in Railway
2. Connect to same repo, set root directory to `frontend`
3. Set build command: `npm run build`
4. Set environment variables
5. Deploy

### Production Considerations

- **HTTPS**: Required for PWA service worker and Google OAuth
- **CORS**: Update `CORS_ORIGINS` in backend to match frontend domain
- **Environment Variables**: Never commit secrets to git
- **Database**: Use MongoDB Atlas for production
- **Domain**: Set up custom domain if needed
- **Monitoring**: Consider adding logging and error tracking

### Alternative Hosting Options

- **AWS**: Use EC2/ECS for backend, S3+CloudFront for frontend, DocumentDB for database
- **DigitalOcean**: App Platform for full-stack deployment
- **Fly.io**: Good for FastAPI with global deployment
- **Vercel + Railway**: Best combination for React + FastAPI

### PWA Configuration

The app includes PWA features (service worker, manifest, offline support). Ensure:
- HTTPS enabled
- Service worker registered only in production
- Manifest points to correct start_url
- Icons are accessible

For detailed deployment guides, check the documentation of your chosen platform.

## API Documentation

When running the backend locally, visit `http://localhost:8000/docs` for interactive API documentation powered by Swagger UI.

## Contributing

This project follows a sprint-based development approach. See `memory/PRD.md` for the current roadmap and implementation status.

## License

[Add license information here]
