# Architecture Research Notes

This MVP uses a small custom Runtime while borrowing proven ideas from adjacent projects.

## Playwright Codegen

Playwright's test generator records browser interactions and generates locators. Its documentation states that it prioritizes role, text, and test-id locators, and refines locators when multiple elements match. This supports the MVP decision to make Recorder and Locator Engine semantic rather than coordinate-based.

Reference: https://playwright.dev/docs/codegen

## Playwright Trace Viewer

Playwright Trace Viewer records local evidence for debugging failed browser runs. It can open a saved `trace.zip` locally, and the hosted viewer loads trace files in the browser without transmitting data externally. This supports the MVP Trace Service design: keep sensitive Douyin Baiying evidence local and inspectable.

Reference: https://playwright.dev/docs/trace-viewer

## Temporal

Temporal separates workflows, activities, workers, timeouts, schedules, cancellation, and observability. The MVP does not adopt Temporal, but it borrows the boundary between durable workflow state and side-effecting activities such as browser clicks.

Reference: https://docs.temporal.io/develop/typescript

## XState / Statecharts

XState models behavior as state machines whose states transition when events occur. It also separates machine logic from actions, actors, guards, and delays. This supports the project's Event Driven FSM design.

Reference: https://stately.ai/docs/machines

## Electron Process Model

Electron apps have a main process and renderer processes. The main process can use Node APIs and manages windows; renderer processes display UI. This supports keeping browser automation and local file access outside the renderer behind a narrow preload API.

Reference: https://www.electronjs.org/docs/latest/tutorial/process-model

## electron-vite

electron-vite provides one configuration point for main, preload, and renderer builds and supports fast development with Vite. It is a good fit when the placeholder desktop app becomes a real Electron shell.

Reference: https://electron-vite.org/guide/
