import { AppConfig } from './app-config';
import { type EnvironmentVariables, IntegrationsMode } from './env.schema';

const make = (env: Partial<EnvironmentVariables>) => new AppConfig(env as EnvironmentVariables);

describe('AppConfig.useFakeObjectStorage', () => {
  it('follows INTEGRATIONS_MODE when OBJECT_STORAGE_MODE is unset', () => {
    expect(make({ INTEGRATIONS_MODE: IntegrationsMode.Fake }).useFakeObjectStorage).toBe(true);
    expect(make({ INTEGRATIONS_MODE: IntegrationsMode.Real }).useFakeObjectStorage).toBe(false);
  });

  it('lets S3 be real while every other provider stays fake', () => {
    const config = make({
      INTEGRATIONS_MODE: IntegrationsMode.Fake,
      OBJECT_STORAGE_MODE: IntegrationsMode.Real,
    });
    expect(config.useFakes).toBe(true);
    expect(config.useFakeObjectStorage).toBe(false);
  });

  it('can keep object storage fake in an otherwise real stack', () => {
    const config = make({
      INTEGRATIONS_MODE: IntegrationsMode.Real,
      OBJECT_STORAGE_MODE: IntegrationsMode.Fake,
    });
    expect(config.useFakes).toBe(false);
    expect(config.useFakeObjectStorage).toBe(true);
  });
});
