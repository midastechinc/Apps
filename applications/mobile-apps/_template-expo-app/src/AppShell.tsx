import { StyleSheet, Text, View } from "react-native";
import { theme } from "./theme";

export function AppShell() {
  return (
    <View style={styles.screen}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Midas Tech Mobile Template</Text>
        <Text style={styles.title}>Build the first useful screen, then wire data and release flow.</Text>
        <Text style={styles.body}>
          This template is meant to be copied into a real app folder, connected to its own GitHub repo,
          and then registered on the dashboard with an APK link.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Suggested next steps</Text>
        <Text style={styles.cardItem}>1. Rename the app in app.json and package.json.</Text>
        <Text style={styles.cardItem}>2. Replace this starter screen with your first feature flow.</Text>
        <Text style={styles.cardItem}>3. Add environment variables in .env and .env.example.</Text>
        <Text style={styles.cardItem}>4. Create the GitHub repo before the app grows.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.background,
    gap: theme.spacing.lg
  },
  hero: {
    marginTop: theme.spacing.xl,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: theme.colors.accent
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
    color: theme.colors.text
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    color: theme.colors.muted
  },
  card: {
    padding: theme.spacing.lg,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.sm
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.brand
  },
  cardItem: {
    fontSize: 15,
    lineHeight: 22,
    color: theme.colors.text
  }
});
