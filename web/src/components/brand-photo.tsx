import { readdirSync } from "node:fs";
import path from "node:path";
import Image from "next/image";

/**
 * Brand photography from public/brand/photos/<name>.webp (see public/brand/photos/IMAGE-REQUESTS.md).
 * The photos are decorative and optional: pages are designed to stand on their own, and a photo
 * appears once its file is dropped in (the folder is read once per server start).
 */
const PHOTO_DIR = path.join(process.cwd(), "public", "brand", "photos");
const AVAILABLE: ReadonlySet<string> = new Set(readdirSync(PHOTO_DIR).filter((f) => f.endsWith(".webp")).map((f) => f.slice(0, -5)));

export function hasBrandPhoto(name: string): boolean {
  return AVAILABLE.has(name);
}

export function BrandPhoto({ name, alt, className, priority }: { name: string; alt: string; className: string; priority: boolean }) {
  if (!AVAILABLE.has(name)) return null;
  return <Image src={`/brand/photos/${name}.webp`} alt={alt} fill sizes="(min-width: 1024px) 50vw, 100vw" className={className} priority={priority} />;
}
