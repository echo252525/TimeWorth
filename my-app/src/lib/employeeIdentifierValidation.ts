/** Max length for employee number / admin employee ID in forms (DB-safe, avoids abuse). */
export const MAX_EMPLOYEE_IDENTIFIER_LENGTH = 100

/**
 * Validates employee number / admin employee ID for signup and profile forms.
 * Only requires a non-empty value after trim and a reasonable max length (any characters allowed).
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
  return null
}
