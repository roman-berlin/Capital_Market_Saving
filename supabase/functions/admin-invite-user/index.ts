import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const OWNER_EMAIL = Deno.env.get("OWNER_EMAIL");

interface InviteRequest {
  email: string;
  name?: string;
  role?: "user" | "admin";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Get requesting user from JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: requestingUser }, error: userError } = await anonClient.auth.getUser();
    
    if (userError || !requestingUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role client for admin operations
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    // Check if requesting user is admin or owner
    const { data: requestingRole } = await serviceClient
      .from("user_roles")
      .select("role")
      .eq("user_id", requestingUser.id)
      .single();

    const isAdminOrOwner = requestingRole?.role === "admin" || requestingRole?.role === "owner";
    if (!isAdminOrOwner) {
      return new Response(JSON.stringify({ error: "Forbidden: Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { email, name, role = "user" }: InviteRequest = await req.json();

    // Input validation
    if (!email || typeof email !== 'string' || !email.includes('@') || email.length > 255) {
      return new Response(JSON.stringify({ error: "Invalid email address" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (name && (typeof name !== 'string' || name.length > 100)) {
      return new Response(JSON.stringify({ error: "Name must be less than 100 characters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (role !== 'user' && role !== 'admin') {
      return new Response(JSON.stringify({ error: "Invalid role" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only owner can create admins
    if (role === "admin" && requestingRole?.role !== "owner") {
      return new Response(JSON.stringify({ error: "Only owner can create admin users" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if user already exists
    const { data: existingUsers } = await serviceClient.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find(u => u.email === email);
    
    if (existingUser) {
      return new Response(JSON.stringify({ error: "User with this email already exists" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create user with a temporary random password (they'll set their own via invite link)
    const tempPassword = crypto.randomUUID() + crypto.randomUUID();
    const { data: newUser, error: createError } = await serviceClient.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name, invited: true },
    });

    if (createError || !newUser.user) {
      console.error("Error creating user:", createError);
      return new Response(JSON.stringify({ error: "Failed to create user" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create user role
    await serviceClient.from("user_roles").insert({
      user_id: newUser.user.id,
      role: role,
    });

    // Generate invite token
    const token = crypto.randomUUID();
    const tokenHash = await hashToken(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await serviceClient.from("auth_tokens").insert({
      user_id: newUser.user.id,
      token_type: "invite",
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
    });

    // Send invite email using fetch
    const appUrl = req.headers.get("origin") || "https://automaxity.info";
    const inviteLink = `${appUrl}/set-password?token=${token}&email=${encodeURIComponent(email)}`;

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Portfolio Ammo <noreply@automaxity.info>",
        to: [email],
        subject: "You've been invited to Portfolio Ammo",
        html: `
          <h1>Welcome to Portfolio Ammo${name ? `, ${name}` : ""}!</h1>
          <p>You've been invited to join Portfolio Ammo. Click the link below to set your password and activate your account.</p>
          <p><a href="${inviteLink}" style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Set Your Password</a></p>
          <p>This link will expire in 1 hour.</p>
          <p>If you didn't expect this invitation, you can safely ignore this email.</p>
        `,
      }),
    });

    const emailData = await emailResponse.json();
    console.log("Invite email sent:", emailData);

    return new Response(JSON.stringify({ 
      success: true, 
      message: "Invitation sent successfully",
      userId: newUser.user.id 
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in admin-invite-user:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
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
