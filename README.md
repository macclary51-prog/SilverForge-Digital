# SilverForge Digital Solutions

Official source repository for the SilverForge Digital Solutions website and private lead CRM.

## Website

The website is built with:

- HTML
- CSS
- JavaScript
- GitHub Pages
- Google Analytics
- Firebase Authentication
- Firebase Cloud Firestore

Custom domain:

`silverforgedigitalsolutions.com`

## Public pages

- `index.html` — Home
- `development.html` — App and website development
- `social-media.html` — Social media and content services
- `portfolio.html` — Selected work and future case studies
- `downloads.html` — SilverForge applications and software
- `about.html` — Business information
- `contact.html` — Project-request form
- `support.html` — Support information
- `privacy.html` — Website and application privacy information
- `updates.html` — Development updates
- `screenshots.html` — Project visual previews

The old `projects.html` path redirects to `portfolio.html`.

## CRM

The website includes a private customer relationship management system for handling project inquiries.

CRM files:

- `crm-login.html`
- `crm-login.js`
- `crm.html`
- `crm.js`
- `crm.css`
- `firebase-config.js`
- `firestore.rules`

CRM features include:

- Email-and-password administrator sign-in
- Administrator role verification
- Real-time Firestore lead updates
- Lead search and status filtering
- Lead pipeline statuses
- Quote amounts
- Follow-up dates
- Internal notes
- Customer call and email links
- Lead deletion
- Summary statistics

## Lead pipeline

Supported lead statuses:

1. New
2. Contacted
3. Qualified
4. Quote Sent
5. Accepted
6. In Progress
7. Completed
8. Lost

## Firestore collections

### `leads`

Each project-request document contains:

```text
name
business
email
phone
service
message
status
quoteAmount
followUpDate
internalNotes
createdAt
updatedAt
