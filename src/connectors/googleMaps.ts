import type { PropertyParcel } from '../engine/types';

export interface GoogleMapsLinks {
  maps3D: string;
  streetView: string;
  directions: string;
  aerial: string;
  streetViewStaticImg: string | null;
}

/**
 * Zero-key Google Maps Platform deep links + optional BYOK Street View Static
 * image URL (only activated when user enters a Google Maps API key in Settings).
 */
export function buildGoogleMapsLinks(p: PropertyParcel, apiKey?: string): GoogleMapsLinks {
  const lat = p.lat.toFixed(6);
  const lng = p.lng.toFixed(6);
  const q = encodeURIComponent(p.address || `${lat},${lng}`);
  const cleanKey = apiKey?.trim() || '';

  return {
    maps3D: `https://www.google.com/maps/@${lat},${lng},18z/data=!3m1!1e3`,
    streetView: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`,
    directions: `https://www.google.com/maps/dir/?api=1&destination=${q}`,
    aerial: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    streetViewStaticImg: cleanKey
      ? `https://maps.googleapis.com/maps/api/streetview?size=640x280&location=${lat},${lng}&fov=85&pitch=4&key=${encodeURIComponent(cleanKey)}`
      : null,
  };
}

export async function geocodeWithGoogleMaps(
  address: string,
  apiKey: string
): Promise<{ lat: number; lng: number; formattedAddress: string } | null> {
  if (!apiKey.trim() || !address.trim()) return null;
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(apiKey.trim())}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const first = data?.results?.[0];
    if (!first?.geometry?.location) return null;
    return {
      lat: Number(first.geometry.location.lat),
      lng: Number(first.geometry.location.lng),
      formattedAddress: String(first.formatted_address || address),
    };
  } catch {
    return null;
  }
}
