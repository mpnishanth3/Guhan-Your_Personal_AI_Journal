import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const client = new SecretManagerServiceClient();

/**
 * Retrieves a secret from Google Cloud Secret Manager.
 * @param secretId The ID of the secret (e.g., GEMINI_API_KEY)
 * @param versionId The version of the secret (default: "latest")
 * @returns The secret payload as a string
 */
export async function accessSecret(secretId: string, versionId: string = "latest"): Promise<string> {
  try {
    // We assume the service account running the Cloud Run service has the
    // secretmanager.secretAccessor role.
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || "gen-lang-client-0558990988"; 
    const name = `projects/${projectId}/secrets/${secretId}/versions/${versionId}`;
    
    const [version] = await client.accessSecretVersion({ name });
    const payload = version.payload?.data?.toString();
    
    if (!payload) {
      throw new Error(`Secret ${secretId} payload is empty.`);
    }
    
    return payload;
  } catch (error) {
    console.error(`Error accessing secret ${secretId}:`, error);
    throw new Error(`Failed to access secret: ${secretId}`);
  }
}
