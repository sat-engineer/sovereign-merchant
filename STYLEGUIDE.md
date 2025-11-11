# TypeScript Style Guide: Runtime Safety vs Type Safety

## Philosophy

This project balances TypeScript's compile-time type checking with JavaScript's runtime flexibility. TypeScript developers coming from other ecosystems might find some patterns surprising. This guide explains our approach to handling external data, APIs, and the inevitable uncertainty of real-world web development.

## Core Principles

1. **Fail Gracefully**: Prefer returning `null`, empty arrays, or default values over throwing exceptions for expected failures
2. **Validate Early**: Check for required fields immediately after receiving external data
3. **Log Errors**: Always log when assumptions fail so issues are visible in production
4. **Type Assertions Are Last Resort**: Only use `as any` when dealing with truly unknown external data

## Handling External API Data

### ❌ Avoid: Reckless Type Casting
```typescript
// DON'T DO THIS - Runtime error if 'id' doesn't exist
const storeId = (stores[0] as { id: string }).id;
```

### ✅ Preferred: Safe Optional Chaining with Validation
```typescript
// DO THIS - Safe access with explicit error handling
const storeId = (stores[0] as any)?.id;
if (!storeId) {
  console.error('Store does not have a valid ID field');
  return null; // or [] or default value
}
```

### ✅ Alternative: Type Guards (For Complex Validation)
```typescript
function isValidStore(obj: unknown): obj is { id: string; name?: string } {
  return typeof obj === 'object' &&
         obj !== null &&
         typeof (obj as any).id === 'string';
}

if (!isValidStore(stores[0])) {
  console.error('Invalid store format');
  return null;
}
const storeId = stores[0].id; // Now type-safe
```

### ✅ Advanced: Schema Validation (For Critical Data)
```typescript
import { z } from 'zod';

const StoreSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional()
});

try {
  const store = StoreSchema.parse(stores[0]);
  const storeId = store.id; // Fully validated
} catch (error) {
  console.error('Store validation failed:', error);
  return null;
}
```

## Method Design Patterns

### Return Types for Operations That Might Fail

**For single objects:**
```typescript
async getStore(): Promise<Store | null> {
  // Return null on failure, not throw
}
```

**For collections:**
```typescript
async getStores(): Promise<Store[]> {
  // Return empty array on failure, not throw
}
```

**For boolean results:**
```typescript
async isValid(): Promise<boolean> {
  // Return false on failure, not throw
}
```

### Error Handling Hierarchy

1. **Expected failures** (missing fields, empty responses): Return graceful defaults
2. **Network/API errors**: Try-catch with logging, return graceful defaults
3. **Unexpected errors**: Let bubble up or log critically

```typescript
async exampleMethod(): Promise<Result | null> {
  try {
    // Early validation for expected issues
    const data = await fetchExternalData();
    if (!data?.requiredField) {
      console.error('Missing required field in external data');
      return null;
    }

    // Process data...
    return result;
  } catch (error) {
    // Network issues, parsing errors, etc.
    console.error('Unexpected error:', error);
    return null;
  }
}
```

## Why This Approach?

### Design Philosophy Trade-offs

**Compile-time Safety Focus**: "Prevent runtime crashes through strict type guarantees"
- Exhaustive type checking
- Strict null safety
- Comprehensive validation at build time

**Runtime Resilience Focus**: "Handle real-world uncertainty gracefully"
- APIs change without notice
- Third-party libraries evolve independently
- Users expect resilience over perfection
- Network and external data are inherently unreliable

### Trade-offs

**Benefits:**
- Resilient to API changes
- Clear error logging for debugging
- Consistent user experience
- Easy to maintain and extend

**Costs:**
- Less compile-time safety than Kotlin
- Requires more runtime testing
- Some "obviously wrong" code compiles

## When to Be More Strict

Use full type safety for:
- User input validation
- Internal data structures you control
- Critical business logic
- Data persistence/serialization

Use runtime safety for:
- External API responses
- Third-party library outputs
- Network responses
- Configuration files

## Tooling Recommendations

- **ESLint**: Enforce consistent error handling patterns
- **Zod/Yup**: Schema validation for critical paths
- **Unit tests**: Cover edge cases that TypeScript can't catch
- **Runtime monitoring**: Log when graceful failures occur

## Examples in This Codebase

See `core/src/services/btcpay.ts` for examples of safe external API data handling with graceful degradation.
