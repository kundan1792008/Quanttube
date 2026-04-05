# Quanttube - Production Tasks

## Phase 1: Critical (Week 1-2)
- [ ] Add PostgreSQL database (videos, users, channels, comments tables)
- [ ] Add real video upload + storage (S3/CloudFlare R2)
- [ ] Add video transcoding pipeline (FFmpeg - multiple resolutions)
- [ ] Add CDN integration for video delivery (CloudFront/CloudFlare)
- [ ] Add Quantmail SSO authentication
- [ ] Create Dockerfile and docker-compose.yml for server

## Phase 2: Core Features (Week 3-4)
- [ ] Build video player with adaptive bitrate streaming (HLS/DASH)
- [ ] Implement recommendation engine (collaborative filtering)
- [ ] Add comments, likes, shares functionality
- [ ] Build channel/creator pages
- [ ] Add search with full-text indexing
- [ ] Build reels/shorts vertical video player
- [ ] Create `.github/workflows/ci.yml`

## Phase 3: Integration (Week 5-6)
- [ ] Connect to Quantads for video ad insertion (pre-roll, mid-roll)
- [ ] Connect to Quantedits for in-app video editing
- [ ] Add Quantchat sharing (share videos in chat)
- [ ] Build creator analytics dashboard
- [ ] Add monetization system (creator payouts via x402)
