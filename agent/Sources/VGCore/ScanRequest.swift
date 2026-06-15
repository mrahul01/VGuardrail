// The request the agent submits to the engine for evaluation.

import Foundation

/// A prompt plus the non-content context describing where it came from.
public struct ScanRequest: Codable, Sendable, Equatable {
    /// The prompt/content to scan.
    public var text: String
    /// Origin metadata.
    public var context: ScanContext

    public init(text: String, context: ScanContext) {
        self.text = text
        self.context = context
    }
}

/// Non-content metadata describing the origin of a prompt.
public struct ScanContext: Codable, Sendable, Equatable {
    public var source: Source?
    public var provider: String?
    public var model: String?
    public var app: String?
    public var repo: RepoContext?
    public var file: FileContext?
    public var user: UserContext

    public init(
        source: Source? = nil,
        provider: String? = nil,
        model: String? = nil,
        app: String? = nil,
        repo: RepoContext? = nil,
        file: FileContext? = nil,
        user: UserContext
    ) {
        self.source = source
        self.provider = provider
        self.model = model
        self.app = app
        self.repo = repo
        self.file = file
        self.user = user
    }
}

/// Repository context for IDE/CLI prompts.
public struct RepoContext: Codable, Sendable, Equatable {
    public var name: String
    public var classification: Classification?

    public init(name: String, classification: Classification? = nil) {
        self.name = name
        self.classification = classification
    }
}

/// File context for a prompt referencing a specific file.
public struct FileContext: Codable, Sendable, Equatable {
    public var path: String
    public var fileExtension: String?

    public init(path: String, fileExtension: String? = nil) {
        self.path = path
        self.fileExtension = fileExtension
    }

    private enum CodingKeys: String, CodingKey {
        case path
        case fileExtension = "extension"
    }
}

/// The acting user and RBAC role.
public struct UserContext: Codable, Sendable, Equatable {
    public var userID: String
    public var role: Role
    public var groups: [String]

    public init(userID: String, role: Role = .user, groups: [String] = []) {
        self.userID = userID
        self.role = role
        self.groups = groups
    }

    private enum CodingKeys: String, CodingKey {
        case userID = "user_id"
        case role
        case groups
    }
}
