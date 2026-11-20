import { Badge, Box, Button, Flex, Heading, HStack, Text } from "@chakra-ui/react";
import { useTheme } from "next-themes";
import {
  FiActivity,
  FiList,
  FiMoon,
  FiSettings,
  FiSun,
  FiWifi,
  FiWifiOff,
  FiZap,
} from "react-icons/fi";
import { NavLink, Outlet } from "react-router";

import { useVelina } from "../lib/velina-context";

const navigation = [
  { to: "/tasks", label: "Tasks", icon: FiList },
  { to: "/processes", label: "Processes", icon: FiActivity },
  { to: "/config", label: "Config", icon: FiSettings },
];

export function AppShell() {
  const { connected } = useVelina();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const themeLabel = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <Flex direction="column" minH="100vh">
      <Box as="header" px="6" py="4" borderBottomWidth="1px">
        <Flex align="center" justify="space-between" gap="4">
          <HStack gap="6">
            <HStack gap="2">
              <FiZap aria-hidden="true" />
              <Heading size="md">Velina</Heading>
            </HStack>
            <HStack gap="4">
              {navigation.map((item) => (
                <NavLink key={item.to} to={item.to}>
                  {({ isActive }) => (
                    <Text
                      as="span"
                      display="inline-flex"
                      alignItems="center"
                      gap="1.5"
                      color={isActive ? "teal.600" : "fg.muted"}
                      fontWeight={isActive ? "bold" : "normal"}
                    >
                      <item.icon aria-hidden="true" />
                      {item.label}
                    </Text>
                  )}
                </NavLink>
              ))}
            </HStack>
          </HStack>
          <HStack gap="3">
            <Button
              size="sm"
              variant="ghost"
              aria-label={themeLabel}
              title={themeLabel}
              onClick={() => setTheme(isDark ? "light" : "dark")}
            >
              {isDark ? <FiSun aria-hidden="true" /> : <FiMoon aria-hidden="true" />}
            </Button>
            <Badge
              colorPalette={connected ? "green" : "red"}
              display="inline-flex"
              alignItems="center"
              gap="1"
            >
              {connected ? <FiWifi aria-hidden="true" /> : <FiWifiOff aria-hidden="true" />}
              {connected ? "Connected" : "Reconnecting"}
            </Badge>
          </HStack>
        </Flex>
      </Box>

      <Box as="main" flex="1" p="6">
        <Outlet />
      </Box>
    </Flex>
  );
}
