# Personal Gemini Journal

A highly secure, offline-capable, AI-powered journaling application built with Next.js (App Router), Firebase Authentication, Cloud Firestore, and the Gemini API.

## 1. Environment & Prerequisites

To deploy this application securely, you must provision the following resources in Google Cloud:

1. **Google Cloud Project**: An active Google Cloud project.
2. **Enabled APIs**: Ensure the following APIs are enabled in your Google Cloud Console:
   - Cloud Run API (\`run.googleapis.com\`)
   - Secret Manager API (\`secretmanager.googleapis.com\`)
   - Cloud Build API (\`cloudbuild.googleapis.com\`)
   - Firestore API (\`firestore.googleapis.com\`)
3. **Firebase Setup**:
   - Initialize a Firebase Project linked to your Google Cloud Project.
   - Enable **Firebase Authentication** (Google Sign-In provider).
   - Enable **Cloud Firestore** in Native Mode.
4. **CLI Tools**: Ensure you have the \`gcloud\` CLI installed and authenticated locally.

## 2. Secret Management Setup (Zero-Hardcoding)

This application strictly adheres to zero-hardcoding hygiene. The \`GEMINI_API_KEY\` must be securely stored in Google Cloud Secret Manager and accessed at runtime.

Run the following commands in your terminal to provision the secret:

\`\`\`bash
# Create and populate the secret
gcloud secrets create GEMINI_API_KEY --replication-policy="automatic"
echo -n "YOUR_API_KEY" | gcloud secrets versions add GEMINI_API_KEY --data-file=-

# Grant the default Cloud Run service account access to read the secret
# Replace YOUR_PROJECT_NUMBER with your actual Google Cloud Project Number
gcloud secrets add-iam-policy-binding GEMINI_API_KEY \\
  --member="serviceAccount:YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com" \\
  --role="roles/secretmanager.secretAccessor"
\`\`\`

## 3. Database Security Configuration

This application relies on isolated user data boundaries. You must deploy strict Firestore Security Rules to prevent cross-user data leakage.

**Security Rule Payload (\`firestore.rules\`)**:
\`\`\`javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
\`\`\`

**Deploy the rules using the Firebase CLI:**
\`\`\`bash
firebase deploy --only firestore:rules
\`\`\`

## 4. Cloud Run Deployment Flow

The codebase includes a highly-optimized multistage \`Dockerfile\` tailored for Next.js Standalone execution.

To build and deploy the container to Cloud Run, execute:

\`\`\`bash
gcloud run deploy personal-gemini-journal \\
  --source . \\
  --region=us-central1 \\
  --allow-unauthenticated \\
  --set-env-vars=GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID
\`\`\`
*(Replace \`YOUR_PROJECT_ID\` with your actual project ID).*

## 5. Required Campaign Labeling (Challenge Verification)

To register this deployment for the Cloud Run AI Challenge verification, you **must** apply the mandatory resource label to your Cloud Run service.

Execute the following command immediately after deployment:

\`\`\`bash
gcloud run services update personal-gemini-journal \\
  --update-labels=dev-tutorial=cloud-run-ai-challenge \\
  --region=us-central1
\`\`\`
