# Repository Guidelines

## Project Structure & Module Organization

This repository combines HWPX document tooling with a Next.js studio app.

- Root Python utilities: `build_hwpx.py`, `figure_processor.py`, and `workspaces/crop/*.py`.
- Documentation and implementation plans: `docs/`.
- Inputs, examples, and archived material: `inputs/`, `sample/`, `archive/`.
- Web app: `studio/`, a pnpm-based Next.js project.
- App routes and API endpoints: `studio/app/`.
- Shared app logic: `studio/lib/`; tests live beside modules in `__tests__/`.
- UI components: `studio/components/`, with reusable primitives in `components/ui/`.
- Static assets: `studio/public/`.

## Build, Test, and Development Commands

Run app commands from `studio/`.

- `pnpm dev`: starts Next.js on port `3020`.
- `pnpm dev:sse`: starts the local SSE server from `server/sse.ts`.
- `pnpm build`: creates a production Next.js build.
- `pnpm start`: serves the production build.
- `pnpm lint`: runs ESLint.
- `pnpm test`: runs Vitest once.
- `npx vitest run lib/__tests__/store.test.ts --reporter=basic`: runs a focused test file.

Do not install dependencies from WSL or Unix-like agent sessions against a Windows checkout. If dependencies are missing, ask the user to run `pnpm install` from Windows.

## Coding Style & Naming Conventions

Use TypeScript, React function components, and existing Next.js App Router patterns. Keep component filenames in PascalCase, for example `FileDropzone.tsx`, and utility modules in camelCase or domain names, for example `pipelineStages.ts` and `cropper/coords.ts`. Prefer helpers from `lib/` and primitives from `components/ui/`.

Python scripts should stay standard-library friendly where practical and use clear snake_case names. Preserve Korean domain terms and HWPX filename patterns.

## Testing Guidelines

Vitest is the active test framework. Add unit tests next to code under `__tests__/` and name files `*.test.ts`. Cover parsing, file-path, crop-coordinate, and store behavior when changing those modules. Run `pnpm test` before larger changes and focused `npx vitest run ...` commands while iterating.

## Commit & Pull Request Guidelines

Recent history uses concise Conventional Commit style, often with scopes: `feat(crop): ...`, `fix(auto-crop): ...`, `docs(create-v4): ...`, and `chore(deps): ...`. Keep subjects imperative and specific.

Pull requests should include a short problem summary, the implemented change, test results, and screenshots or sample files for UI, PDF, cropper, or HWPX output changes. Link related issues or planning docs when applicable.

## Security & Configuration Tips

Use `studio/.env.example` as the configuration reference. Do not commit secrets, generated caches, local outputs, or private exam material unless the repository already tracks that exact fixture intentionally.
