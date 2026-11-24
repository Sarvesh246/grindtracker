import 'server-only'

export function garminPersonalConfig() {
  const userId = process.env.GARMIN_PERSONAL_OWNER_ID?.trim()
  const key = process.env.GARMIN_PERSONAL_API_KEY?.trim()
  if (process.env.GARMIN_PERSONAL_ENABLED !== 'true' || !key ||
    !userId || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(userId)) return null
  return { userId, key }
}
