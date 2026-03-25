"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config = {
    rootDir: ".",
    testEnvironment: "node",
    moduleFileExtensions: ["ts", "tsx", "js", "json"],
    transform: {
        "^.+\\.(t|j)sx?$": [
            "ts-jest",
            {
                tsconfig: "<rootDir>/../../tsconfig.base.json"
            }
        ]
    },
    testMatch: ["<rootDir>/src/**/*.spec.ts"]
};
exports.default = config;
