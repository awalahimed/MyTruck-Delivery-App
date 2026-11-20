import { useEffect, useState } from "react";
import { getDownloadURL, ref } from "firebase/storage";
import { storage } from "../firebase";

const DIRECT_URI = /^(https?:\/\/|file:|content:|data:)/i;

export function getImageSourceKey(input) {
  if (typeof input === "number") return `asset:${input}`;
  if (typeof input === "string") return input.trim();
  if (input && typeof input === "object") {
    if (typeof input.uri === "string") return input.uri.trim();
    try {
      return JSON.stringify(input);
    } catch (_) {
      return "image-object";
    }
  }
  return "";
}

/** Resolve direct image URIs and Firebase Storage object paths consistently. */
export default function useFirebaseImageSource(input) {
  const key = getImageSourceKey(input);
  const [resolved, setResolved] = useState(null);

  useEffect(() => {
    let active = true;
    setResolved(null);

    if (typeof input === "number") {
      setResolved({ key, value: input });
      return () => { active = false; };
    }

    const uri = typeof input === "string"
      ? input.trim()
      : typeof input?.uri === "string"
      ? input.uri.trim()
      : "";

    if (!uri) {
      if (input && typeof input === "object" && !("uri" in input) && active) setResolved({ key, value: input });
      return () => { active = false; };
    }

    if (DIRECT_URI.test(uri)) {
      setResolved({ key, value: typeof input === "object" ? { ...input, uri } : { uri } });
      return () => { active = false; };
    }

    // Image values from older records may contain a Storage path (or gs:// URL)
    // instead of a downloadable https URL. Convert them at display time.
    getDownloadURL(ref(storage, uri))
      .then((downloadUrl) => {
        if (active) setResolved({ key, value: { ...(typeof input === "object" ? input : {}), uri: downloadUrl } });
      })
      .catch(() => {
        if (active) {
          setResolved({ key, value: null });
        }
      });

    return () => { active = false; };
  }, [key]);

  return resolved?.key === key ? resolved.value : null;
}
