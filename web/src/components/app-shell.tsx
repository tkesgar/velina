import { Badge, Box, Button, Flex, Heading, HStack, Text } from "@chakra-ui/react";
import { useTheme } from "next-themes";
import { NavLink, Outlet } from "react-router";

import { useVelina } from "../lib/velina-context";

const navigation = [
  { to: "/tasks", label: "Tasks" },
  { to: "/processes", label: "Processes" },
  { to: "/config", label: "Config" },
];

export function AppShell() {
  const { connected } = useVelina();
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Flex direction="column" minH="100vh">
      <Box as="header" px="6" py="4" borderBottomWidth="1px">
        <Flex align="center" justify="space-between" gap="4">
          <HStack gap="6">
            <Heading size="md">Velina</Heading>
            <HStack gap="4">
              {navigation.map((item) => (
                <NavLink key={item.to} to={item.to}>
                  {({ isActive }) => (
                    <Text
                      as="span"
                      color={isActive ? "teal.600" : "fg.muted"}
                      fontWeight={isActive ? "bold" : "normal"}
                    >
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
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            >
              {resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
            </Button>
            <Badge colorPalette={connected ? "green" : "red"}>
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
