# RangeOps — Shooting Range Management

A local-first shooting range operations frontend built with Vite, React, and TypeScript. The app runs entirely in your browser; demo data is persisted to localStorage and no cloud services or external requests are required.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (normally `http://localhost:5173`). Build the production bundle with `npm run build`.

To make the development server reachable by other devices on your LAN, run `npm run dev -- --host 0.0.0.0` and use the host machine's LAN address.

## Demo sign-in

| Role | Username | Password |
| --- | --- | --- |
| Administrator | `admin` | `admin123` |
| Staff | `staff` | `staff123` |

## Included workflows

- Dashboard with range activity, participant category charts, and recent activity
- Participant register with search, filters, validation, bulk selection, and spreadsheet import
- Code128 pouch barcode labels with print layout
- Touch-friendly scan station with manual lookup and duplicate-scan protection
- Transaction audit log and reason-required corrections
- Excel reports, user permissions, and event/local data settings
- Local JSON backup and restore

## Connecting a backend

All persistent domain data is accessed through [`src/services/api.ts`](./src/services/api.ts). Replace the localStorage-backed functions there with calls to your backend while retaining the typed interfaces in [`src/types/index.ts`](./src/types/index.ts). `src/services/mockData.ts` provides the first-run seed dataset (40 participants and demo users). UI state and permissions live in `src/store/useAppStore.ts`.

For a LAN deployment, build with `npm run build` and serve the generated `dist` folder from a machine reachable on your network. Browser localStorage is per browser profile/device; a shared multi-device register requires the backend service noted above.
