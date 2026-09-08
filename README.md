# Guhan — Your Personal AI Journal & Reflection Sanctuary

A highly secure, offline-capable, AI-powered journaling and mindfulness sanctuary application built with Next.js (App Router), Firebase Authentication, Cloud Firestore, Firebase Storage, and Google Cloud Vertex AI.

---

## 1. Environment & Prerequisites

To deploy this application securely, you must provision the following resources in Google Cloud:

1. **Google Cloud Project**: An active Google Cloud project with billing enabled (e.g., using your $300 trial credits).
2. **Enabled APIs**: Ensure the following APIs are enabled in your Google Cloud Console:
   - Cloud Run API (`run.googleapis.com`)
   - Vertex AI API (`aiplatform.googleapis.com`)
   - Cloud Build API (`cloudbuild.googleapis.com`)
   - Cloud Firestore API (`firestore.googleapis.com`)
   - Cloud Storage API (`storage.googleapis.com`)
3. **Firebase Setup**:
   - Initialize a Firebase Project linked to your Google Cloud Project.
   - Enable **Firebase Authentication** (Google Sign-In provider).
   - Enable **Cloud Firestore** in Native Mode.
   - Enable **Firebase Cloud Storage** for media attachments.
4. **CLI Tools**: Ensure you have installed and authenticated:
   - `gcloud` CLI (`gcloud auth login`, `gcloud config set project YOUR_PROJECT_ID`)
   - `firebase` CLI (`npm install -g firebase-tools` and `firebase login`)

---

## 2. Dedicated Service Account Security (Zero-Trust)

To maximize security, this application avoids using the default Compute Engine service account. Instead, you should provision a dedicated service account with the principle of least privilege.

### Create the Service Account:
```bash
gcloud iam service-accounts create guhan-sa --display-name="Guhan Service Account"
```

### Grant Required Roles:
The application requires the following four roles to function perfectly:
```bash
export PROJECT_ID=$(gcloud config get-value project)
export SA_EMAIL="guhan-sa@${PROJECT_ID}.iam.gserviceaccount.com"

# 1. Vertex AI User (for Gemini model access)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/aiplatform.user"

# 2. Cloud Datastore User (for Firestore backend operations)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/datastore.user"

# 3. Storage Object Viewer (for Firebase Storage media fetching)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectViewer"

# 4. Secret Manager Accessor (Optional, if using Secret Manager for other keys)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"
```

---

## 3. Database & Storage Security Rules

This application relies on zero-trust user data boundaries and immutability enforcement.

- **Firestore Rules (`firestore.rules`)**: Enforces per-user data isolation and strict 7-day immutability on reflection entries.
- **Storage Rules (`storage.rules`)**: Enforces isolated media attachment storage with MIME validation (images/videos up to 5MB).

**Deploy both security rule sets using the Firebase CLI:**
```bash
firebase deploy --only firestore:rules,storage
```

---

## 4. Cloud Run Deployment Flow

The codebase includes an optimized multi-stage `Dockerfile` tailored for Next.js Standalone execution.

To build and deploy the container service to Cloud Run in one command (using your dedicated service account and Vertex AI):

```bash
gcloud run deploy guhan-ai-journal \
  --source . \
  --region=asia-south1 \
  --allow-unauthenticated \
  --port=3000 \
  --service-account="guhan-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --update-env-vars=GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID,GOOGLE_CLOUD_LOCATION=asia-south1,FIREBASE_PROJECT_ID=YOUR_PROJECT_ID,FIREBASE_STORAGE_BUCKET=YOUR_PROJECT_ID.firebasestorage.app \
  --labels=dev-tutorial=cloud-run-ai-challenge
```

*(Replace `YOUR_PROJECT_ID` with your actual Google Cloud Project ID. You can also change the `GOOGLE_CLOUD_LOCATION` to `us-central1` if you prefer to access the latest experimental Gemini models).*

---

## 5. Campaign Labeling Verification (Challenge Requirement)

To verify the Cloud Run AI Challenge requirement, the service label `dev-tutorial=cloud-run-ai-challenge` must be present.

If you deployed using the command in Step 4, the label is already applied. You can also verify or re-apply it anytime with:

```bash
gcloud run services update guhan-ai-journal \
  --update-labels=dev-tutorial=cloud-run-ai-challenge \
  --region=asia-south1
```

To confirm the label is applied:
```bash
gcloud run services describe guhan-ai-journal \
  --region=asia-south1 \
  --format="value(metadata.labels)"
```
