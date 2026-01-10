# Changelog

All notable changes to WAFB (WebADB Forensics Bridge) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 🎉 Android Packages, Logcat & Architecture Refactor
This release introduces detailed acquisition support for installed packages and Logcat, along with a significant refactoring of the frontend architecture for better scalability.

### Added

#### Core Package (@wafb/core)
- **New PackagesAcquirer Module**: Full acquisition of installed packages list via ADB, including system/user filtering and SHA-256 integrity.
- **Logcat Acquisition Support**: Exported `LogcatAcquirer` and related types (`LogcatConfig`, `LogcatStats`, `LogcatData`) for system log retrieval.
- **Detailed Metadata**: Extraction of SDK versions and declared permissions via `dumpsys`.

#### Web Package (@wafb/web)
- **Dynamic Acquisition Engine**: Implemented a mapping (Factory) pattern in `AcquisitionPage` for managing acquirers dynamically.
- **Integrated Support**: Added execution flow for both `packages` and `bugreport` types using the new factory pattern.

### Changed

#### Core Package
- **API Exports**: Updated main index to properly export new forensic acquisition modules.

#### Web Package
- **Acquisition Store**: Improved type handling in `acquisitionStore.ts` using explicit casting for session acquisition lookups.
- **Acquisition UI Refactor**: Simplified logic by removing static conditional chains and optimizing CSS transitions for progress states.

### Removed

#### Web Package
- **Obsolete Code Cleanup**: Removed unused hooks (`useADB`, `useBugreport`, `useForensics`, `useReport`) and deprecated components (`ErrorBoundary`, `Layout`).

## [0.1.0] - 2025-01-10

### 🎉 First Stable Release
This release marks the transition from alpha to the first production-ready version of WAFB, with significant improvements in code quality, testing, and forensic integrity.

### Added

#### Core Package (@wafb/core)
- **Enhanced Forensic Integrity**
  - Forensic-grade cleanup tracking with `cleanupPerformed` flag
  - Public `wasCleanupPerformed()` method for verification
  - Cleanup attempt guaranteed even on acquisition failure
  - Critical logging for cleanup failures (essential for chain of custody)
  
- **Test Infrastructure**
  - Comprehensive test suite: 26 bugreport tests + 8 logger + 8 device + 8 commands + 11 connection tests
  - Reusable test helpers library (`createMockAdb`, `createMockDevice`, `createMockShellSocket`, etc.)
  - Stream helpers tests with full coverage
  - Integration test skeleton for physical device validation
  - Coverage thresholds enforced: 80% lines/functions/statements, 75% branches
  
- **Acquisition Framework Enhancements**
  - Structured metadata for all 9 acquisition types
  - SDK version compatibility checking
  - Root requirement validation
  - Default enable/disable logic based on device capabilities

#### Web Package (@wafb/web)
- **Acquisition Store (Zustand)**
  - Complete state management for multi-acquisition sessions
  - Progress aggregation across multiple acquisitions
  - Session lifecycle tracking (preparing → running → completed/failed/cancelled)
  - Device info persistence throughout session
  - 37 comprehensive tests covering all store functionality
  
- **Test Infrastructure**
  - Vitest setup with happy-dom environment
  - Test utilities for ACQUISITION_TYPES mocking
  - Complete store test coverage (initialization, selection, progress, completion)

### Changed

#### Core Package
- **Module Structure**: Flattened acquisition module hierarchy
  - `forensics/acquisition/base/types.ts` → `forensics/acquisition/types.ts`
  - `forensics/acquisition/bugreport/BugreportAcquirer.ts` → `forensics/acquisition/bugreport.ts`
  - Improved maintainability and reduced nesting
  
- **Logger Improvements**
  - Browser detection for CSS formatting (prevents pollution in test output)
  - Performance optimization: `slice()` instead of `shift()` for log retention
  - Consistent use of `console.log` for standard messages
  
- **BugreportAcquirer Cleanup Logic**
  - Cleanup now tracked with internal `cleanupPerformed` flag
  - Dedicated `performCleanup()` private method with robust error handling
  - Always attempts cleanup even on acquisition failure
  - Cleanup status included in `AcquisitionResult.data.cleanupPerformed`

#### Web Package
- **Acquisition Store**: `window` → `globalThis` for ACQUISITION_TYPES
  - Ensures compatibility with test environments (happy-dom)
  - Works seamlessly in both browser and Node.js contexts
  - Fixed initialization issues in Vitest

### Fixed

#### Core Package
- **Logger Performance**: Use `slice()` instead of `shift()` for maintaining log history
- **Test Environment Compatibility**: Logger CSS formatting now detects browser context
- **Cleanup Tracking**: Failures are logged as CRITICAL with full error context
- **Device Test Mocking**: Refactored to use shared test helpers, eliminating code duplication

#### Web Package
- **Test Initialization**: ACQUISITION_TYPES properly initialized in test environment via `globalThis`
- **Store Reset**: Proper cleanup between tests to avoid state pollution

### Testing

#### 🎯 All Tests Passing: 63/63 ✅

#### Core Package (@wafb/core) - 61 tests
- **Bugreport Acquisition** (26 tests)
  - Bugreportz zip format and legacy text fallback
  - **Cleanup verification** (critical for forensics!)
  - Progress reporting validation
  - Error handling (device disconnection, timeout, command failures)
  - Hash computation (SHA-256)
  - Metadata inclusion (timestamps, duration, file size)
  - Edge cases (cleanup on failure, parsing errors)
  
- **ADB Components**
  - Logger (8 tests): Level filtering, log retention, context tracking
  - Device (8 tests): Properties, root detection, battery info
  - Commands (8 tests): Shell execution, timeout, file operations
  - Connection (11 tests): Connect, disconnect, retry logic, error handling
  
- **Stream Helpers** (6 tests): Text/binary reading, concatenation, retry mechanism
- **Packages Acquisition** (6 tests): Package listing and filtering

#### Web Package (@wafb/web) - 37 tests
- **Acquisition Store** (37 tests)
  - Initialization and reset (2)
  - Acquisition initialization (6): Root/SDK filtering, device info
  - Selection management (5): Toggle, select all, deselect all
  - Session management (5): Start, unique IDs, validation
  - Progress tracking (5): Individual and total progress
  - Completion handling (3): Success, failure, session updates
  - Session lifecycle (3): End conditions, timestamps
  - Computed values (6): Selected acquisitions, session state
  - Edge cases (3): Empty states, non-existent acquisitions

#### Test Infrastructure
- **Reusable Helpers**: Mock factories for ADB, devices, connections, streams
- **Coverage**: 80%+ lines/functions/statements, 75%+ branches
- **CI Integration**: Turbo-powered caching for faster test runs

### Developer Experience

- **Turbo Test Configuration**: Test output caching and coverage report retention
- **Vitest Config**: Unified test setup across packages with proper timeouts
- **Test Helpers Library**: Eliminates boilerplate and ensures consistency
- **CI/CD**: All tests run automatically on every push via GitHub Actions

### Security & Forensic Integrity

- ✅ **Cleanup Tracking**: Every acquisition reports if cleanup was performed
- ✅ **Chain of Custody**: Timestamps, hashes, and metadata for all acquisitions
- ✅ **Error Resilience**: Cleanup attempted even on acquisition failure
- ✅ **Audit Trail**: CRITICAL logging for cleanup failures
- ✅ **No Traces**: Ensures forensic operations don't contaminate evidence

---

## [0.1.0-alpha] - 2026-01-08