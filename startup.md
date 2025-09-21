# FUCKIT Development Startup Guide

## Prerequisites

- Node.js (version 18 or higher)
- PostgreSQL database running locally
- Required environment variables configured

## Environment Setup

1. **Database Setup**
   ```bash
   # Ensure PostgreSQL is running
   brew services start postgresql
   # or
   sudo service postgresql start
   ```

2. **Environment Variables**
   - Copy `.env.example` to `.env.local`
   - Configure required API keys:
     - `PODCAST_INDEX_API_KEY`
     - `PODCAST_INDEX_API_SECRET`
     - Database connection string
     - Other service API keys as needed

## Starting the Development Server

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Database Migration**
   ```bash
   npx prisma generate
   npx prisma db push
   ```

3. **Start Development Server**
   ```bash
   npm run dev
   ```

   The server will start on http://localhost:3000

## Common Issues & Solutions

### Port 3000 Already in Use
```bash
# Find and kill process using port 3000
lsof -i :3000
kill -9 <PID>

# Or let Next.js use a different port
npm run dev
```

### Service Worker Cache Issues
```bash
# Clear Next.js cache and service worker files
rm -rf .next
rm -f public/sw.js public/workbox-*.js
npm run dev
```

### Database Connection Issues
```bash
# Reset database connection
npx prisma db push --force-reset
npx prisma generate
```

### Build Errors
```bash
# Run type checking
npm run build

# Check for TypeScript errors
npx tsc --noEmit
```

## Development Workflow

1. **Start fresh session:**
   ```bash
   npm run dev
   ```

2. **Clean restart (if needed):**
   ```bash
   rm -rf .next
   npm run dev
   ```

3. **Test build:**
   ```bash
   npm run build
   ```

## Mobile Testing

- Development server accessible at: `http://192.168.0.238:3000`
- For reliable mobile testing, use production deployment
- Service worker features work better in production

## Production Deployment

Changes are automatically deployed via Railway when pushed to main branch:
```bash
git add .
git commit -m "your changes"
git push
```

## Useful Commands

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run lint` - Run ESLint
- `npx prisma studio` - Open database GUI
- `npx prisma db push` - Push schema changes to database