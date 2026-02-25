/**
 * User Profile Service – handles storage and retrieval of user
 * learning profiles in the database.
 */

import prisma from "../config/database";

export interface UserProfileInput {
  skill: string;
  contentPreferences: string[];
  learningPace: string;
  sessionLength: string;
  difficultyPreference: string;
  proficiencyScore: number;
}

/**
 * Save or update a user profile.
 */
export async function saveUserProfile(data: UserProfileInput) {
  try {
    // For this simple version, we'll create a new profile each time.
    // In a full app, we would use an auth userID to unique identify the profile.
    const profile = await prisma.userProfile.create({
      data: {
        skill: data.skill,
        contentPreferences: data.contentPreferences,
        learningPace: data.learningPace,
        sessionLength: data.sessionLength,
        difficultyPreference: data.difficultyPreference,
        proficiencyScore: data.proficiencyScore,
      },
    });

    console.log(`✅ User profile saved: ${profile.id} for skill "${profile.skill}"`);
    return profile;
  } catch (error: any) {
    console.error(`❌ Failed to save user profile: ${error.message}`);
    throw error;
  }
}

/**
 * Retrieve a user profile by ID.
 */
export async function getUserProfile(id: string) {
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { id },
    });

    if (!profile) {
      console.log(`⚠️  User profile not found: ${id}`);
    }

    return profile;
  } catch (error: any) {
    console.error(`❌ Failed to get user profile: ${error.message}`);
    throw error;
  }
}

/**
 * Get the latest user profile for a specific skill.
 */
export async function getLatestProfileBySkill(skill: string) {
  try {
    const profile = await prisma.userProfile.findFirst({
      where: { skill },
      orderBy: { createdAt: "desc" },
    });

    return profile;
  } catch (error: any) {
    console.error(`❌ Failed to get latest profile by skill: ${error.message}`);
    throw error;
  }
}
