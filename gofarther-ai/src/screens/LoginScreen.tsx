import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Alert, ActivityIndicator, ScrollView } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { C, F, R } from '../lib/theme';
import { login, signup, socialLogin } from '../lib/api';

WebBrowser.maybeCompleteAuthSession();

// Google OAuth Client IDs — replace with your own from Google Cloud Console
const GOOGLE_CLIENT_ID_WEB = '321209982665-uboadljp5d0hl426rrntnnmg8c6l5v2f.apps.googleusercontent.com';
const GOOGLE_CLIENT_ID_IOS = '321209982665-uboadljp5d0hl426rrntnnmg8c6l5v2f.apps.googleusercontent.com';

export default function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode] = useState<'welcome' | 'email-login' | 'email-signup'>('welcome');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  // Check Apple Sign-In availability
  useEffect(() => {
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  // Google Auth
  const [googleRequest, googleResponse, googlePromptAsync] = Google.useAuthRequest({
    webClientId: GOOGLE_CLIENT_ID_WEB,
    iosClientId: GOOGLE_CLIENT_ID_IOS,
  });

  useEffect(() => {
    if (googleResponse?.type === 'success') {
      handleGoogleAuth(googleResponse.authentication?.accessToken || '');
    }
  }, [googleResponse]);

  const handleGoogleAuth = async (accessToken: string) => {
    if (!accessToken) return;
    setLoading(true);
    try {
      // Get user info from Google
      const res = await fetch('https://www.googleapis.com/userinfo/v2/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const user = await res.json();
      // Login or signup with the backend
      await socialLogin(user.email, user.name || user.given_name || 'User', 'google', accessToken);
      onLogin();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Google sign-in failed');
    } finally { setLoading(false); }
  };

  const handleAppleAuth = async () => {
    setLoading(true);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      const appleEmail = credential.email || '';
      const appleName = credential.fullName
        ? `${credential.fullName.givenName || ''} ${credential.fullName.familyName || ''}`.trim()
        : 'Apple User';
      // Login or signup with backend
      await socialLogin(appleEmail, appleName, 'apple', credential.identityToken || '');
      onLogin();
    } catch (e: any) {
      if (e.code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('Error', e.message || 'Apple sign-in failed');
      }
    } finally { setLoading(false); }
  };

  const handleEmailLogin = async () => {
    if (!email || !password) { Alert.alert('Error', 'Please fill in all fields'); return; }
    setLoading(true);
    try {
      await login(email.toLowerCase().trim(), password);
      onLogin();
    } catch (e: any) { Alert.alert('Error', e.message || 'Login failed'); }
    finally { setLoading(false); }
  };

  const handleEmailSignup = async () => {
    if (!name || !email || !password) { Alert.alert('Error', 'Please fill in all fields'); return; }
    if (password.length < 6) { Alert.alert('Error', 'Password must be at least 6 characters'); return; }
    setLoading(true);
    try {
      await signup(email.toLowerCase().trim(), name.trim(), password);
      onLogin();
    } catch (e: any) { Alert.alert('Error', e.message || 'Signup failed'); }
    finally { setLoading(false); }
  };

  if (loading) {
    return (
      <View style={[s.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={C.primary} size="large" />
        <Text style={{ color: C.textMid, marginTop: 16, fontSize: F.sm }}>Signing in...</Text>
        <Text style={{ color: C.textDim, marginTop: 8, fontSize: F.xs, textAlign: 'center', paddingHorizontal: 40 }}>First login may take a moment while the server wakes up</Text>
      </View>
    );
  }

  if (mode === 'welcome') {
    return (
      <View style={s.container}>
        <View style={s.logoArea}>
          <View style={s.orb} />
          <Text style={s.title}>GoFarther AI</Text>
          <Text style={s.sub}>Your AI agent, everywhere</Text>
        </View>

        <View style={s.buttonArea}>
          {/* Apple Sign-In */}
          {appleAvailable && (
            <TouchableOpacity style={s.socialBtn} onPress={handleAppleAuth}>
              <Text style={s.appleIcon}>🍎</Text>
              <Text style={s.socialBtnText}>Continue with Apple</Text>
            </TouchableOpacity>
          )}

          {/* Google Sign-In */}
          <TouchableOpacity style={s.socialBtnGoogle} onPress={() => googlePromptAsync()} disabled={!googleRequest}>
            <Text style={s.googleIcon}>G</Text>
            <Text style={s.socialBtnTextGoogle}>Continue with Google</Text>
          </TouchableOpacity>

          <View style={s.divider}>
            <View style={s.dividerLine} />
            <Text style={s.dividerText}>or</Text>
            <View style={s.dividerLine} />
          </View>

          <TouchableOpacity style={s.emailBtn} onPress={() => setMode('email-signup')}>
            <Text style={s.emailBtnText}>Sign up with email</Text>
          </TouchableOpacity>

          <View style={s.loginRow}>
            <Text style={s.loginText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => setMode('email-login')}>
              <Text style={s.loginLink}>Log in</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={s.terms}>By continuing, you agree to our Terms of Service and Privacy Policy</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={s.backBtn} onPress={() => setMode('welcome')}>
          <Text style={s.backText}>← Back</Text>
        </TouchableOpacity>

        <View style={s.formLogo}>
          <View style={s.orbSmall} />
          <Text style={s.formTitle}>{mode === 'email-login' ? 'Welcome back' : 'Create your account'}</Text>
          <Text style={s.formSub}>{mode === 'email-login' ? 'Log in to GoFarther AI' : 'Start your AI journey'}</Text>
        </View>

        {mode === 'email-signup' && (
          <TextInput style={s.input} placeholder="Full name" placeholderTextColor={C.textDim} value={name} onChangeText={setName} autoCapitalize="words" />
        )}
        <TextInput style={s.input} placeholder="Email address" placeholderTextColor={C.textDim} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
        <TextInput style={s.input} placeholder={mode === 'email-signup' ? 'Create password (min 6 characters)' : 'Password'} placeholderTextColor={C.textDim} value={password} onChangeText={setPassword} secureTextEntry />

        {mode === 'email-login' && (
          <TouchableOpacity style={s.forgotBtn}>
            <Text style={s.forgotText}>Forgot password?</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={s.submitBtn} onPress={mode === 'email-login' ? handleEmailLogin : handleEmailSignup}>
          <Text style={s.submitBtnText}>{mode === 'email-login' ? 'Log In' : 'Create Account'}</Text>
        </TouchableOpacity>

        <View style={s.switchRow}>
          <Text style={s.switchText}>{mode === 'email-login' ? "Don't have an account? " : 'Already have an account? '}</Text>
          <TouchableOpacity onPress={() => setMode(mode === 'email-login' ? 'email-signup' : 'email-login')}>
            <Text style={s.switchLink}>{mode === 'email-login' ? 'Sign up' : 'Log in'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  scrollContent: { flex: 1, justifyContent: 'center', padding: 24 },
  logoArea: { alignItems: 'center', marginTop: 80, marginBottom: 48 },
  orb: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.primary, shadowColor: C.primary, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 30, marginBottom: 20 },
  title: { fontSize: 28, fontWeight: '800', color: C.text, marginBottom: 6 },
  sub: { fontSize: F.md, color: C.textMid },
  buttonArea: { flex: 1, paddingHorizontal: 24 },
  socialBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderRadius: R.md, padding: 16, marginBottom: 12 },
  appleIcon: { fontSize: 20, marginRight: 10 },
  socialBtnText: { fontSize: F.md, fontWeight: '600', color: '#000' },
  socialBtnGoogle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.card, borderRadius: R.md, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: C.border },
  googleIcon: { fontSize: 18, fontWeight: '700', color: '#4285F4', marginRight: 10 },
  socialBtnTextGoogle: { fontSize: F.md, fontWeight: '600', color: C.text },
  divider: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.border },
  dividerText: { paddingHorizontal: 16, fontSize: F.sm, color: C.textDim },
  emailBtn: { borderRadius: R.md, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: C.primary, marginBottom: 16 },
  emailBtnText: { fontSize: F.md, fontWeight: '600', color: C.primary },
  loginRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 8 },
  loginText: { fontSize: F.sm, color: C.textMid },
  loginLink: { fontSize: F.sm, fontWeight: '600', color: C.primary },
  terms: { position: 'absolute', bottom: 40, left: 0, right: 0, fontSize: 10, color: C.textDim, textAlign: 'center', paddingHorizontal: 40 },
  backBtn: { marginBottom: 24 },
  backText: { fontSize: F.md, color: C.primary, fontWeight: '500' },
  formLogo: { alignItems: 'center', marginBottom: 32 },
  orbSmall: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.primary, shadowColor: C.primary, shadowOpacity: 0.4, shadowRadius: 16, marginBottom: 16 },
  formTitle: { fontSize: F.xl, fontWeight: '700', color: C.text, marginBottom: 4 },
  formSub: { fontSize: F.sm, color: C.textMid },
  input: { width: '100%', padding: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: R.md, color: C.text, fontSize: F.md, marginBottom: 14 },
  forgotBtn: { alignSelf: 'flex-end', marginBottom: 8, marginTop: -6 },
  forgotText: { fontSize: F.xs, color: C.primary },
  submitBtn: { width: '100%', padding: 16, borderRadius: R.md, backgroundColor: C.primary, alignItems: 'center', marginTop: 8 },
  submitBtnText: { color: 'white', fontSize: F.md, fontWeight: '700' },
  switchRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 20 },
  switchText: { fontSize: F.sm, color: C.textMid },
  switchLink: { fontSize: F.sm, fontWeight: '600', color: C.primary },
});
