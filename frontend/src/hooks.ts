import { useEffect, useRef, useState } from 'react';
import { api } from './api';

export function useApiData<T>(path: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const previousPath = useRef(path);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    if (previousPath.current !== path) { setData(undefined); previousPath.current = path; }
    void api<T>(path, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(result.data);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, revision]);
  return { data, error, loading, refresh: () => setRevision((value) => value + 1) };
}

export function useSubmission() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [success, setSuccess] = useState('');
  const active = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function submit<T>(
    operation: () => Promise<T>,
    onSaved: (value: T) => void,
    message: string,
  ) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(undefined);
    setSuccess('');
    try {
      const result = await operation();
      if (active.current) {
        onSaved(result);
        setSuccess(message);
      }
    } catch (reason) {
      if (active.current) setError(reason);
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }
  return { pending, error, success, submit };
}
