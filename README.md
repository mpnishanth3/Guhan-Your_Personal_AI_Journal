# Guhan — Your Personal AI Journal & Reflection Sanctuary

A highly secure, offline-capable, AI-powered journaling and mindfulness sanctuary application built with Next.js (App Router), Firebase Authentication, Cloud Firestore, Firebase Storage, and Google Cloud Gemini API.

---

## 1. Environment & Prerequisites

To deploy this application securely, you must provision the following resources in Google Cloud:

1. **Google Cloud Project**: An active Google Cloud project with billing enabled.
2. **Enabled APIs**: Ensure the following APIs are enabled in your Google Cloud Console:
   - Cloud Run API (`run.googleapis.com`)
   - Secret Manager API (`secretmanager.googleapis.com`)
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

## 2. Secret Management Setup (Zero-Hardcoding)

This application strictly adheres to zero-hardcoding hygiene. The `GEMINI_API_KEY` must be securely stored in Google Cloud Secret Manager and accessed at runtime.

### Provision the Secret:

**Linux / macOS / Bash:**
```bash
# 1. Create the secret container
gcloud secrets create GEMINI_API_KEY --replication-policy="automatic"

# 2. Add secret payload
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets versions add GEMINI_API_KEY --data-file=-
```

**Windows (PowerShell):**
```powershell
# 1. Create the secret container
gcloud secrets create GEMINI_API_KEY --replication-policy="automatic"

# 2. Add secret payload (using text file to prevent trailing newline)
[System.IO.File]::WriteAllText("$pwd/gemini_key.tmp", "YOUR_GEMINI_API_KEY")
gcloud secrets versions add GEMINI_API_KEY --data-file="gemini_key.tmp"
Remove-Item "gemini_key.tmp"
```

### Grant Access to Cloud Run Service Account:
```bash
# Grant the Cloud Run service account access to read the secret
# Replace YOUR_PROJECT_NUMBER with your actual Google Cloud Project Number
gcloud secrets add-iam-policy-binding GEMINI_API_KEY \
  --member="serviceAccount:YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
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

To build and deploy the container service to Cloud Run in one command:

```bash
gcloud run deploy guhan-ai-journal \
  --source . \
  --region=us-central1 \
  --allow-unauthenticated \
  --port=8080 \
  --labels=dev-tutorial=cloud-run-ai-challenge \
  --set-secrets=GEMINI_API_KEY=GEMINI_API_KEY:latest \
  --set-env-vars=GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID,FIREBASE_PROJECT_ID=YOUR_PROJECT_ID,FIREBASE_STORAGE_BUCKET=YOUR_PROJECT_ID.firebasestorage.app
```

*(Replace `YOUR_PROJECT_ID` with your actual Google Cloud Project ID).*

---

## 5. Campaign Labeling Verification (Challenge Requirement)

To verify the Cloud Run AI Challenge requirement, the service label `dev-tutorial=cloud-run-ai-challenge` must be present.

If you deployed using the command in Step 4, the label is already applied. You can also verify or re-apply it anytime with:

```bash
gcloud run services update guhan-ai-journal \
  --update-labels=dev-tutorial=cloud-run-ai-challenge \
  --region=us-central1
```

To confirm the label is applied:
```bash
gcloud run services describe guhan-ai-journal \
  --region=us-central1 \
  --format="value(metadata.labels)"
```
