"use client";

import { useState } from "react";

/**
 * Local editable copy of a store value that resets whenever the source value
 * changes (React's "adjust state during render" pattern, no effect needed).
 */
export function useDraft<T>(value: T): [T, (v: T) => void] {
  const [draft, setDraft] = useState(value);
  const [prev, setPrev] = useState(value);
  if (!Object.is(prev, value)) {
    setPrev(value);
    setDraft(value);
  }
  return [draft, setDraft];
}

/** Runs `onOpen` during render the moment `open` flips from false to true. */
export function useOnOpen(open: boolean, onOpen: () => void) {
  const [prev, setPrev] = useState(open);
  if (open !== prev) {
    setPrev(open);
    if (open) onOpen();
  }
}
