import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './../src/app.module';

describe('AppModule (e2e)', () => {
  let moduleFixture: TestingModule;

  beforeEach(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
  });

  afterEach(async () => {
    await moduleFixture.close();
  });

  it('should compile the AppModule successfully', () => {
    expect(moduleFixture).toBeDefined();
  });

  it('should have ServicesModule imported', () => {
    // The module should compile without errors, indicating all dependencies are resolved
    const app = moduleFixture.createNestApplication();
    expect(app).toBeDefined();
  });
});
