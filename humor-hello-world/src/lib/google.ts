// Google client IDs identify public browser apps; they are not secrets.
// This project's registered client is the default, with an override for forks.
export const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  "777667178972-3f4l5aup7s7lnlgknalhj68iht7s9n1n.apps.googleusercontent.com";
