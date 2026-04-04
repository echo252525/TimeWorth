/** Max length for employee number / admin employee ID in forms (DB-safe, avoids abuse). */
export const MAX_EMPLOYEE_IDENTIFIER_LENGTH = 100

/**
 * Validates a trimmed employee number or admin employee ID.
 * Allows letters, digits, spaces, and common punctuation (e.g. ADM-001, EMP/12).
 * @returns Error message or null if valid.
 */
export function validateEmployeeIdentifier(
  raw: string,
  fieldLabel = 'Employee number'
): string | null {
  const s = raw.trim()
  if (!s) return `${fieldLabel} is required`
  if (s.length > MAX_EMPLOYEE_IDENTIFIER_LENGTH) {
    return `${fieldLabel} must be ${MAX_EMPLOYEE_IDENTIFIER_LENGTH} characters or fewer`
  }
  if (/[\r\n]/.test(s)) return `${fieldLabel} cannot contain line breaks`
  return null
}
