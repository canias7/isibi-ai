/** Contact lookup — find phone number by name (with caching) */
import * as Contacts from 'expo-contacts';

// Cache contacts for 5 minutes to avoid re-fetching on every action
let contactCache: Contacts.Contact[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 300000; // 5 min

async function getContacts(): Promise<Contacts.Contact[]> {
  if (contactCache && Date.now() - cacheTime < CACHE_TTL) return contactCache;
  const { status } = await Contacts.requestPermissionsAsync();
  if (status !== 'granted') return [];
  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails, Contacts.Fields.Name],
  });
  contactCache = data || [];
  cacheTime = Date.now();
  return contactCache;
}

export async function findContactNumber(name: string): Promise<string | null> {
  try {
    const data = await getContacts();
    if (data.length === 0) return null;

    const lower = name.toLowerCase().trim();

    // Try exact match first
    for (const c of data) {
      const fullName = (c.name || '').toLowerCase();
      const firstName = (c.firstName || '').toLowerCase();
      const lastName = (c.lastName || '').toLowerCase();
      const nickname = (c as any).nickname?.toLowerCase() || '';

      if (fullName === lower || firstName === lower || lastName === lower || nickname === lower) {
        if (c.phoneNumbers && c.phoneNumbers.length > 0) {
          return c.phoneNumbers[0].number || null;
        }
      }
    }

    // Try partial match
    for (const c of data) {
      const fullName = (c.name || '').toLowerCase();
      const firstName = (c.firstName || '').toLowerCase();

      if (fullName.includes(lower) || firstName.includes(lower)) {
        if (c.phoneNumbers && c.phoneNumbers.length > 0) {
          return c.phoneNumbers[0].number || null;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

export async function findContactEmail(name: string): Promise<string | null> {
  try {
    const data = await getContacts();
    if (data.length === 0) return null;

    const lower = name.toLowerCase().trim();

    for (const c of data) {
      const fullName = (c.name || '').toLowerCase();
      const firstName = (c.firstName || '').toLowerCase();

      if (fullName === lower || firstName === lower || fullName.includes(lower)) {
        if (c.emails && c.emails.length > 0) {
          return c.emails[0].email || null;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}
