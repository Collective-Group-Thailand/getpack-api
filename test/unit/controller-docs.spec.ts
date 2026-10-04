import { type DynamicModule, type Type } from '@nestjs/common';

import { AppModule } from '../../src/app.module';

// Metadata keys of @nestjs/common and @nestjs/swagger (their constants are not exported by the packages).
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';
const MODULE_METADATA = { IMPORTS: 'imports', CONTROLLERS: 'controllers' } as const;
const DECORATORS = {
  API_OPERATION: 'swagger/apiOperation',
  API_RESPONSE: 'swagger/apiResponse',
  API_EXTENSION: 'swagger/apiExtension',
  API_EXCLUDE_ENDPOINT: 'swagger/apiExcludeEndpoint',
  API_EXCLUDE_CONTROLLER: 'swagger/apiExcludeController',
} as const;

type ModuleRef = Type<unknown> | DynamicModule | Promise<DynamicModule> | { forwardRef: () => unknown };

/** Every controller reachable from AppModule (static and dynamic modules, forward references). */
function controllersOf(root: Type<unknown>): Type<unknown>[] {
  const seen = new Set<unknown>();
  const found = new Set<Type<unknown>>();
  const visit = (ref: ModuleRef | undefined): void => {
    if (!ref || ref instanceof Promise) return;
    const resolved = 'forwardRef' in ref ? (ref.forwardRef() as ModuleRef) : ref;
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    const dynamic = 'module' in resolved ? resolved : undefined;
    const type = (dynamic ? dynamic.module : resolved) as Type<unknown>;
    const read = (key: string) => (Reflect.getMetadata(key, type) as unknown[] | undefined) ?? [];
    for (const controller of [...read(MODULE_METADATA.CONTROLLERS), ...(dynamic?.controllers ?? [])])
      found.add(controller as Type<unknown>);
    for (const child of [...read(MODULE_METADATA.IMPORTS), ...(dynamic?.imports ?? [])])
      visit(child as ModuleRef);
  };
  visit(root);
  return [...found];
}

describe('every route handler is documented (U-B2, contract §5)', () => {
  const controllers = controllersOf(AppModule);

  it('finds the controllers', () => {
    expect(controllers.length).toBeGreaterThan(100);
  });

  it('carries ApiEndpoint, ApiStandardErrors and a success response on every handler', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const controller of controllers) {
      if (Reflect.getMetadata(DECORATORS.API_EXCLUDE_CONTROLLER, controller)) continue;
      // Own and inherited handlers (generic base controllers declare routes on their prototype).
      const names = new Set<string>();
      for (
        let p = controller.prototype as object | null;
        p && p !== Object.prototype;
        p = Object.getPrototypeOf(p)
      )
        for (const name of Object.getOwnPropertyNames(p)) names.add(name);
      const proto = controller.prototype as Record<string, unknown>;
      for (const name of names) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        if (Reflect.getMetadata(DECORATORS.API_EXCLUDE_ENDPOINT, handler)) continue;
        checked += 1;
        const where = `${controller.name}.${name}`;
        const operation = Reflect.getMetadata(DECORATORS.API_OPERATION, handler) as
          { operationId?: string } | undefined;
        const extensions = (Reflect.getMetadata(DECORATORS.API_EXTENSION, handler) ?? {}) as Record<
          string,
          unknown
        >;
        const responses = (Reflect.getMetadata(DECORATORS.API_RESPONSE, handler) ?? {}) as Record<
          string,
          unknown
        >;
        if (!operation?.operationId) missing.push(`${where}: no @ApiEndpoint`);
        if (!('x-packio-errors-standard' in extensions)) missing.push(`${where}: no @ApiStandardErrors`);
        if (!Object.keys(responses).some((status) => /^2\d\d$/.test(status)))
          missing.push(`${where}: no success response (@ApiSuccess / @ApiPaginated)`);
      }
    }
    expect(missing).toEqual([]);
    // Every operation of the contract (1 343 at v0.39.0) comes from one of these handlers.
    expect(checked).toBeGreaterThanOrEqual(1343);
  });
});
