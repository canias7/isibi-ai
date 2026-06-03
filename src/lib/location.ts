/** Location services */
import * as Location from 'expo-location';

export async function getCurrentLocation(): Promise<{ lat: number; lng: number; address: string } | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const [place] = await Location.reverseGeocodeAsync({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
    });

    const address = place
      ? [place.street, place.city, place.region].filter(Boolean).join(', ')
      : `${loc.coords.latitude.toFixed(4)}, ${loc.coords.longitude.toFixed(4)}`;

    return { lat: loc.coords.latitude, lng: loc.coords.longitude, address };
  } catch { return null; }
}
