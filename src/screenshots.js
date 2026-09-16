import { supabase } from "./supabase";

export const SCREENSHOT_BUCKET = "bug-screenshots";
export const MAX_SCREENSHOTS = 5;
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
/** Supabase free-tier storage budget we respect for this bucket. */
export const STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024; // 1 GB
/** Start pruning once usage + incoming would exceed this. */
export const STORAGE_SOFT_LIMIT_BYTES = Math.floor(STORAGE_LIMIT_BYTES * 0.9); // 900 MB
/** After pruning, aim to land around this usage. */
export const STORAGE_TARGET_BYTES = Math.floor(STORAGE_LIMIT_BYTES * 0.8); // 800 MB

export const ALLOWED_SCREENSHOT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export function normalizeScreenshotUrls(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }
  return [];
}

export function validateScreenshotFile(file) {
  if (!file) return "No file selected.";
  if (!ALLOWED_SCREENSHOT_TYPES.has(file.type)) {
    return "Use PNG, JPEG, WebP, or GIF images only.";
  }
  if (file.size > MAX_SCREENSHOT_BYTES) {
    return "Each screenshot must be 5 MB or smaller.";
  }
  return "";
}

function extensionFor(file) {
  const fromName = (file.name || "").split(".").pop()?.toLowerCase();
  if (fromName && fromName.length <= 5) return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  return "jpg";
}

export function storagePathFromPublicUrl(url) {
  if (!url) return "";
  const marker = `/object/public/${SCREENSHOT_BUCKET}/`;
  const idx = String(url).indexOf(marker);
  if (idx === -1) return "";
  return decodeURIComponent(String(url).slice(idx + marker.length));
}

export function publicUrlForPath(path) {
  const { data } = supabase.storage.from(SCREENSHOT_BUCKET).getPublicUrl(path);
  return data?.publicUrl || "";
}

async function listScreenshotObjects(prefix = "") {
  const objects = [];
  const pageSize = 100;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(SCREENSHOT_BUCKET).list(prefix || "", {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    if (!data?.length) break;

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const isFolder = entry.id == null && !entry.metadata?.size;
      if (isFolder) {
        const nested = await listScreenshotObjects(path);
        objects.push(...nested);
      } else {
        objects.push({
          path,
          size: Number(entry.metadata?.size) || 0,
          createdAt: entry.created_at || entry.updated_at || "",
        });
      }
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return objects;
}

async function detachUrlsFromBugs(deletedUrls) {
  if (!deletedUrls.length) return;
  const deletedSet = new Set(deletedUrls);
  const { data: rows, error } = await supabase.from("bugs").select("id, screenshot_urls");
  if (error) throw error;

  for (const row of rows || []) {
    const current = normalizeScreenshotUrls(row.screenshot_urls);
    const next = current.filter((url) => !deletedSet.has(url));
    if (next.length === current.length) continue;
    await supabase
      .from("bugs")
      .update({ screenshot_urls: next, updated_at: new Date().toISOString() })
      .eq("id", row.id);
  }
}

/**
 * If bucket usage + incoming upload would exceed the soft limit, delete the
 * oldest screenshots until usage is near STORAGE_TARGET_BYTES.
 * Keeps protectPaths (e.g. screenshots still attached on the form).
 */
export async function ensureScreenshotStorageRoom({
  incomingBytes = 0,
  protectPaths = [],
} = {}) {
  const protectedSet = new Set((protectPaths || []).filter(Boolean));

  let objects;
  try {
    objects = await listScreenshotObjects();
  } catch (e) {
    console.warn("Could not list screenshots for storage cleanup", e);
    return { deletedUrls: [], deletedCount: 0, bytesFreed: 0, skipped: true };
  }

  let totalBytes = objects.reduce((sum, obj) => sum + (obj.size || 0), 0);
  if (totalBytes + incomingBytes <= STORAGE_SOFT_LIMIT_BYTES) {
    return { deletedUrls: [], deletedCount: 0, bytesFreed: 0, skipped: false };
  }

  const candidates = objects
    .filter((obj) => !protectedSet.has(obj.path))
    .sort((a, b) => {
      const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
      const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
      if (ta !== tb) return ta - tb;
      return a.path.localeCompare(b.path);
    });

  const toRemove = [];
  let bytesFreed = 0;
  const needBelow = Math.max(0, STORAGE_TARGET_BYTES - incomingBytes);

  for (const obj of candidates) {
    if (totalBytes - bytesFreed <= needBelow) break;
    toRemove.push(obj);
    bytesFreed += obj.size || 0;
  }

  if (!toRemove.length) {
    return { deletedUrls: [], deletedCount: 0, bytesFreed: 0, skipped: false };
  }

  const paths = toRemove.map((obj) => obj.path);
  const { error: removeError } = await supabase.storage.from(SCREENSHOT_BUCKET).remove(paths);
  if (removeError) throw removeError;

  const deletedUrls = paths.map(publicUrlForPath).filter(Boolean);
  try {
    await detachUrlsFromBugs(deletedUrls);
  } catch (e) {
    console.warn("Removed storage objects but failed to sync bug rows", e);
  }

  return {
    deletedUrls,
    deletedCount: paths.length,
    bytesFreed,
    skipped: false,
  };
}

export async function uploadScreenshot(bugId, file) {
  const err = validateScreenshotFile(file);
  if (err) throw new Error(err);

  const path = `${bugId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extensionFor(file)}`;
  const { error } = await supabase.storage
    .from(SCREENSHOT_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "image/png",
    });
  if (error) throw error;

  const { data } = supabase.storage.from(SCREENSHOT_BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("Upload succeeded but public URL is missing.");
  return data.publicUrl;
}

export async function deleteScreenshotUrls(urls) {
  const paths = normalizeScreenshotUrls(urls)
    .map(storagePathFromPublicUrl)
    .filter(Boolean);
  if (!paths.length) return;
  await supabase.storage.from(SCREENSHOT_BUCKET).remove(paths);
}
