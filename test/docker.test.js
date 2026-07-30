import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

describe('Docker Integration Test', () => {
  const imageName = 'bedrock-server-manager:integration-test';
  const containerName = 'bsm-integration-test-container';
  const hostPort = 33033;

  // Build the Docker image once before running the test
  beforeAll(async () => {
    // Stop and remove any pre-existing container with the same name
    try {
      await execPromise(`docker rm -f ${containerName}`);
    } catch (_) {
      // Ignore error if container doesn't exist
    }

    console.log('Building Docker image for integration tests...');
    await execPromise(`docker build -t ${imageName} .`);
  }, 60000); // Allow up to 60 seconds to build the image

  afterAll(async () => {
    console.log('Cleaning up Docker container and image...');
    try {
      await execPromise(`docker rm -f ${containerName}`);
    } catch (err) {
      console.warn(`Warning: Failed to stop/remove container: ${err.message}`);
    }

    try {
      await execPromise(`docker rmi ${imageName}`);
    } catch (err) {
      console.warn(`Warning: Failed to remove image: ${err.message}`);
    }
  }, 20000);

  it('should build and run the Docker container successfully and expose the status API', async () => {
    // Run the container in detached mode
    console.log(`Starting container ${containerName} on port ${hostPort}...`);
    await execPromise(
      `docker run -d --name ${containerName} -p ${hostPort}:3000 ${imageName}`
    );

    // Poll the endpoint until it responds with 200 OK
    const statusUrl = `http://localhost:${hostPort}/api/status`;
    let isUp = false;
    const maxRetries = 15;
    const delayMs = 1000;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(statusUrl);
        if (response.ok) {
          const body = await response.json();
          console.log('Received response from container:', body);
          expect(body).toHaveProperty('status');
          isUp = true;
          break;
        }
      } catch (err) {
        // Wait and retry
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    expect(isUp).toBe(true);
  }, 30000);
});
