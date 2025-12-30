import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

interface ForgotPasswordRequest {
  email: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const { email }: ForgotPasswordRequest = await req.json();

    // Rate limit check - stricter for security
    const rateLimitResult = await checkRateLimit(serviceClient, email, "forgot_password", 3, 15);
    if (!rateLimitResult.allowed) {
      // Still return success to not reveal if email exists
      return new Response(JSON.stringify({ 
        success: true, 
        message: "If an account exists with this email, a password reset link has been sent." 
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find user by email (don't reveal if exists)
    const { data: users } = await serviceClient.auth.admin.listUsers();
    const user = users?.users?.find(u => u.email === email);
    
    // Always return success to not reveal if email exists
    if (!user) {
      console.log("Password reset requested for non-existent email:", email);
      return new Response(JSON.stringify({ 
        success: true, 
        message: "If an account exists with this email, a password reset link has been sent." 
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Generate reset token
    const token = crypto.randomUUID();
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    // Invalidate any existing reset tokens for this user
    await serviceClient
      .from("auth_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("token_type", "reset")
      .is("used_at", null);

    // Create new reset token
    await serviceClient.from("auth_tokens").insert({
      user_id: user.id,
      token_type: "reset",
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
    });

    // Send reset email using fetch
    const appUrl = req.headers.get("origin") || "https://automaxity.info";
    const resetLink = `${appUrl}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Portfolio Ammo <noreply@automaxity.info>",
        to: [email],
        subject: "Reset Your Password - Portfolio Ammo",
        html: `
          <h1>Password Reset Request</h1>
          <p>We received a request to reset your password for your Portfolio Ammo account.</p>
          <p><a href="${resetLink}" style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Reset Password</a></p>
          <p>This link will expire in 30 minutes.</p>
          <p>If you didn't request this password reset, you can safely ignore this email.</p>
        `,
      }),
    });

    const emailData = await emailResponse.json();
    console.log("Password reset email sent:", emailData);

    return new Response(JSON.stringify({ 
      success: true, 
      message: "If an account exists with this email, a password reset link has been sent." 
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in admin-forgot-password:", error);
    // Don't reveal error details
    return new Response(JSON.stringify({ 
      success: true, 
      message: "If an account exists with this email, a password reset link has been sent." 
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// deno-lint-ignore no-explicit-any
async function checkRateLimit(
  client: any,
  identifier: string,
  action: string,
  maxAttempts: number,
  windowMinutes: number
): Promise<{ allowed: boolean }> {
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  
  const { data: existing } = await client
    .from("rate_limits")
    .select("*")
    .eq("identifier", identifier)
    .eq("action", action)
    .single();

  if (!existing) {
    await client.from("rate_limits").insert({
      identifier,
      action,
      attempt_count: 1,
      window_start: new Date().toISOString(),
    });
    return { allowed: true };
  }

  if (new Date(existing.window_start) < new Date(windowStart)) {
    await client
      .from("rate_limits")
      .update({ attempt_count: 1, window_start: new Date().toISOString() })
      .eq("id", existing.id);
    return { allowed: true };
  }

  if (existing.attempt_count >= maxAttempts) {
    return { allowed: false };
  }

  await client
    .from("rate_limits")
    .update({ attempt_count: existing.attempt_count + 1 })
    .eq("id", existing.id);
  
  return { allowed: true };
}
