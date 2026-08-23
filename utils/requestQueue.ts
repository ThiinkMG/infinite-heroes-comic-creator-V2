/**
 * Request Queue Utility for Managing Concurrent API Calls
 *
 * Features:
 * - Configurable concurrency limit (default: 2 concurrent requests)
 * - Rate limiting (default: 10 requests per minute)
 * - Priority system (high, normal, low)
 * - Queue status tracking (pending, active, completed, failed)
 * - Pause/resume functionality
 *
 * @module utils/requestQueue
 */

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

/**
 * Priority levels for queued requests
 * - high: Processed first (e.g., user-initiated actions)
 * - normal: Default priority (e.g., background generation)
 * - low: Processed last (e.g., prefetching, analytics)
 */
export type RequestPriority = 'high' | 'normal' | 'low';

/**
 * Internal status of a queued request
 */
export type RequestStatus = 'pending' | 'active' | 'completed' | 'failed';

/**
 * Configuration for a request to be queued
 */
export interface QueuedRequest<T> {
  /** Unique identifier for the request */
  id: string;
  /** Priority level for queue ordering */
  priority: RequestPriority;
  /** Async function that executes the actual request */
  execute: () => Promise<T>;
  /** Optional callback invoked on successful completion */
  onComplete?: (result: T) => void;
  /** Optional callback invoked on error */
  onError?: (error: unknown) => void;
}

/**
 * Internal representation of a queued request with tracking info
 */
interface InternalQueuedRequest<T> extends QueuedRequest<T> {
  status: RequestStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: unknown;
}

/**
 * Configuration options for RequestQueue
 */
export interface RequestQueueOptions {
  /** Maximum concurrent requests (default: 2) */
  maxConcurrent?: number;
  /** Maximum requests per minute (default: 10) */
  maxPerMinute?: number;
}

/**
 * Queue status snapshot
 */
export interface QueueStatus {
  /** Number of requests waiting to be processed */
  pending: number;
  /** Number of requests currently being processed */
  active: number;
  /** Number of successfully completed requests */
  completed: number;
  /** Number of failed requests */
  failed: number;
}

/**
 * Event types emitted by the queue
 */
export type QueueEventType =
  | 'request-started'
  | 'request-completed'
  | 'request-failed'
  | 'queue-empty'
  | 'queue-paused'
  | 'queue-resumed';

/**
 * Event listener callback type
 */
export type QueueEventListener = (event: {
  type: QueueEventType;
  requestId?: string;
  error?: unknown;
}) => void;

// ============================================================================
// PRIORITY WEIGHT MAP
// ============================================================================

const PRIORITY_WEIGHTS: Record<RequestPriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

// ============================================================================
// REQUEST QUEUE CLASS
// ============================================================================

/**
 * RequestQueue manages concurrent API calls with rate limiting and priorities.
 *
 * @example
 * ```typescript
 * const queue = new RequestQueue({ maxConcurrent: 2, maxPerMinute: 10 });
 *
 * queue.enqueue({
 *   id: 'gen-page-1',
 *   priority: 'normal',
 *   execute: () => generatePageImage(page1),
 *   onComplete: (result) => console.log('Page 1 complete:', result),
 *   onError: (error) => console.error('Page 1 failed:', error),
 * });
 *
 * // Check status
 * const status = queue.getStatus();
 * console.log(`Pending: ${status.pending}, Active: ${status.active}`);
 *
 * // Pause/resume
 * queue.pause();
 * queue.resume();
 * ```
 */
export class RequestQueue {
  // Configuration
  private maxConcurrent: number;
  private maxPerMinute: number;

  // Queue state
  private queue: Map<string, InternalQueuedRequest<unknown>> = new Map();
  private isPaused: boolean = false;
  private isProcessing: boolean = false;

  // Rate limiting tracking
  private requestTimestamps: number[] = [];

  // Statistics
  private completedCount: number = 0;
  private failedCount: number = 0;

  // Event listeners
  private listeners: QueueEventListener[] = [];

  /**
   * Creates a new RequestQueue instance
   *
   * @param options - Configuration options
   */
  constructor(options?: RequestQueueOptions) {
    this.maxConcurrent = options?.maxConcurrent ?? 2;
    this.maxPerMinute = options?.maxPerMinute ?? 10;
  }

  // ==========================================================================
  // PUBLIC METHODS
  // ==========================================================================

  /**
   * Adjusts concurrency and rate limits on a live queue.
   *
   * Needed because these are user settings that can change between batches,
   * and rebuilding the queue would drop in-flight work.
   *
   * @param options - Partial options to apply; omitted fields keep their value
   */
  updateOptions(options: RequestQueueOptions): void {
    if (options.maxConcurrent !== undefined) {
      this.maxConcurrent = Math.max(1, options.maxConcurrent);
    }
    if (options.maxPerMinute !== undefined) {
      this.maxPerMinute = Math.max(1, options.maxPerMinute);
    }
    // A raised limit may unblock queued work immediately.
    if (!this.isPaused) {
      this.processQueue();
    }
  }

  /**
   * Adds a request to the queue
   *
   * @param request - The request to enqueue
   * @returns The request ID for tracking/cancellation
   */
  enqueue<T>(request: QueuedRequest<T>): string {
    const internalRequest: InternalQueuedRequest<T> = {
      ...request,
      status: 'pending',
      createdAt: Date.now(),
    };

    // Store with type assertion since Map stores unknown
    this.queue.set(request.id, internalRequest as InternalQueuedRequest<unknown>);

    // Trigger processing if not paused
    if (!this.isPaused) {
      this.processQueue();
    }

    return request.id;
  }

  /**
   * Promise-returning wrapper around {@link enqueue}.
   *
   * `enqueue` returns an id and reports results through callbacks, which makes it
   * awkward to use from ordinary async code — the likely reason this queue sat
   * unused while the generation loop ran raw sequential awaits with no rate
   * limiting. `submit` gives callers a plain awaitable while keeping the queue's
   * concurrency and per-minute throttling.
   *
   * @param execute - The async work to run when a slot frees up
   * @param opts - Optional id and priority
   * @returns A promise resolving with the work's result, or rejecting with its error
   */
  submit<T>(
    execute: () => Promise<T>,
    opts: { id?: string; priority?: RequestPriority } = {},
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.enqueue<T>({
        id: opts.id ?? generateRequestId('submit'),
        priority: opts.priority ?? 'normal',
        execute,
        onComplete: resolve,
        onError: reject,
      });
    });
  }

  /**
   * Cancels a pending request
   *
   * @param requestId - The ID of the request to cancel
   * @returns true if the request was found and cancelled, false otherwise
   */
  cancel(requestId: string): boolean {
    const request = this.queue.get(requestId);

    if (!request) {
      return false;
    }

    // Can only cancel pending requests
    if (request.status !== 'pending') {
      return false;
    }

    this.queue.delete(requestId);
    return true;
  }

  /**
   * Pauses queue processing
   * Active requests will complete, but no new requests will start
   */
  pause(): void {
    this.isPaused = true;
    this.emit({ type: 'queue-paused' });
  }

  /**
   * Resumes queue processing after a pause
   */
  resume(): void {
    this.isPaused = false;
    this.emit({ type: 'queue-resumed' });
    this.processQueue();
  }

  /**
   * Clears all pending requests from the queue
   * Active requests will complete, completed/failed stats are preserved
   */
  clear(): void {
    // Only remove pending requests
    for (const [id, request] of this.queue) {
      if (request.status === 'pending') {
        this.queue.delete(id);
      }
    }
  }

  /**
   * Gets the current queue status
   *
   * @returns Object with counts for each request status
   */
  getStatus(): QueueStatus {
    let pending = 0;
    let active = 0;

    for (const request of this.queue.values()) {
      if (request.status === 'pending') pending++;
      if (request.status === 'active') active++;
    }

    return {
      pending,
      active,
      completed: this.completedCount,
      failed: this.failedCount,
    };
  }

  /**
   * Checks if the queue is currently paused
   *
   * @returns true if paused, false otherwise
   */
  getIsPaused(): boolean {
    return this.isPaused;
  }

  /**
   * Adds an event listener for queue events
   *
   * @param listener - Callback function for queue events
   * @returns Unsubscribe function
   */
  addEventListener(listener: QueueEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Resets queue statistics (completed/failed counts)
   * Does not affect pending or active requests
   */
  resetStats(): void {
    this.completedCount = 0;
    this.failedCount = 0;
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  /**
   * Emits an event to all listeners
   */
  private emit(event: { type: QueueEventType; requestId?: string; error?: unknown }): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('[RequestQueue] Event listener error:', e);
      }
    }
  }

  /**
   * Main processing loop - starts eligible requests
   */
  private processQueue(): void {
    // Prevent concurrent processing loops
    if (this.isProcessing || this.isPaused) {
      return;
    }

    this.isProcessing = true;

    try {
      // Get current active count
      const activeCount = this.getActiveCount();

      // Check how many new requests we can start
      const availableSlots = this.maxConcurrent - activeCount;

      if (availableSlots <= 0) {
        return;
      }

      // Check rate limit
      const availableByRateLimit = this.getAvailableByRateLimit();

      if (availableByRateLimit <= 0) {
        // Schedule retry after rate limit window
        this.scheduleRateLimitRetry();
        return;
      }

      // Get pending requests sorted by priority
      const pendingRequests = this.getPendingRequestsSorted();

      // Start requests up to the limit
      const toStart = Math.min(availableSlots, availableByRateLimit, pendingRequests.length);

      for (let i = 0; i < toStart; i++) {
        const request = pendingRequests[i];
        this.executeRequest(request);
      }

      // Check if queue is empty after processing
      if (this.getActiveCount() === 0 && pendingRequests.length === 0) {
        this.emit({ type: 'queue-empty' });
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Executes a single request
   */
  private async executeRequest(request: InternalQueuedRequest<unknown>): Promise<void> {
    // Update status
    request.status = 'active';
    request.startedAt = Date.now();

    // Record timestamp for rate limiting
    this.requestTimestamps.push(Date.now());

    // Emit event
    this.emit({ type: 'request-started', requestId: request.id });

    try {
      // Execute the request
      const result = await request.execute();

      // Mark completed
      request.status = 'completed';
      request.completedAt = Date.now();
      this.completedCount++;

      // Remove from queue (keep only active/pending for status)
      this.queue.delete(request.id);

      // Call success callback
      if (request.onComplete) {
        try {
          request.onComplete(result);
        } catch (e) {
          console.error('[RequestQueue] onComplete callback error:', e);
        }
      }

      // Emit event
      this.emit({ type: 'request-completed', requestId: request.id });
    } catch (error) {
      // Mark failed
      request.status = 'failed';
      request.completedAt = Date.now();
      request.error = error;
      this.failedCount++;

      // Remove from queue
      this.queue.delete(request.id);

      // Call error callback
      if (request.onError) {
        try {
          request.onError(error);
        } catch (e) {
          console.error('[RequestQueue] onError callback error:', e);
        }
      }

      // Emit event
      this.emit({ type: 'request-failed', requestId: request.id, error });
    } finally {
      // Continue processing queue
      this.processQueue();
    }
  }

  /**
   * Gets the count of currently active requests
   */
  private getActiveCount(): number {
    let count = 0;
    for (const request of this.queue.values()) {
      if (request.status === 'active') {
        count++;
      }
    }
    return count;
  }

  /**
   * Gets pending requests sorted by priority (high first), then by creation time
   */
  private getPendingRequestsSorted(): InternalQueuedRequest<unknown>[] {
    const pending: InternalQueuedRequest<unknown>[] = [];

    for (const request of this.queue.values()) {
      if (request.status === 'pending') {
        pending.push(request);
      }
    }

    // Sort by priority weight (lower = higher priority), then by creation time
    pending.sort((a, b) => {
      const priorityDiff = PRIORITY_WEIGHTS[a.priority] - PRIORITY_WEIGHTS[b.priority];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return a.createdAt - b.createdAt;
    });

    return pending;
  }

  /**
   * Calculates how many requests can start based on rate limit
   */
  private getAvailableByRateLimit(): number {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Clean up old timestamps
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);

    // Calculate available slots
    return Math.max(0, this.maxPerMinute - this.requestTimestamps.length);
  }

  /**
   * Schedules a retry when rate limited
   */
  private scheduleRateLimitRetry(): void {
    if (this.requestTimestamps.length === 0) {
      return;
    }

    // Find when the oldest request in the window will expire
    const oldestTimestamp = Math.min(...this.requestTimestamps);
    const retryDelay = Math.max(1000, oldestTimestamp + 60000 - Date.now() + 100);

    setTimeout(() => {
      if (!this.isPaused) {
        this.processQueue();
      }
    }, retryDelay);
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/**
 * Default singleton instance for easy use across the application
 *
 * @example
 * ```typescript
 * import { requestQueue } from './utils/requestQueue';
 *
 * requestQueue.enqueue({
 *   id: 'my-request',
 *   priority: 'normal',
 *   execute: () => fetch('/api/data'),
 * });
 * ```
 */
export const requestQueue = new RequestQueue();

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generates a unique request ID
 *
 * @param prefix - Optional prefix for the ID
 * @returns Unique string ID
 */
export function generateRequestId(prefix: string = 'req'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Creates a RequestQueue with default options optimized for Gemini API
 * - 2 concurrent requests (to avoid overwhelming the model)
 * - 10 requests per minute (conservative rate limit)
 */
export function createGeminiQueue(): RequestQueue {
  return new RequestQueue({
    maxConcurrent: 2,
    maxPerMinute: 10,
  });
}

/**
 * Creates a RequestQueue optimized for image generation
 * - 1 concurrent request (image generation is resource-intensive)
 * - 5 requests per minute (conservative for image models)
 */
export function createImageQueue(): RequestQueue {
  return new RequestQueue({
    maxConcurrent: 1,
    maxPerMinute: 5,
  });
}

export default RequestQueue;
