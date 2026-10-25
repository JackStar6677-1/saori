#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from setuptools import setup, find_packages
from pathlib import Path

this_directory = Path(__file__).parent
long_description = (this_directory / "README.md").read_text(encoding="utf-8") if (this_directory / "README.md").exists() else ""

setup(
    name="saori-ai",
    version="2.0.0",
    author="JackStar Systems",
    author_email="contact@jackstar.dev",
    description="Autonomous Multi-Agent SRE, Neural Observatory & Cognitive Kokoro Framework",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/JackStar6677-1/saori",
    packages=find_packages(include=["kokoro", "kokoro.*", "core", "core.*", "skills", "skills.*"]),
    classifiers=[
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "License :: OSI Approved :: MIT License",
        "Operating System :: POSIX :: Linux",
        "Operating System :: MacOS",
        "Operating System :: Microsoft :: Windows",
        "Topic :: System :: Monitoring",
        "Topic :: Scientific/Engineering :: Artificial Intelligence",
    ],
    python_requires=">=3.10",
    install_requires=[],
    extras_require={
        "tui": ["textual>=0.40.0", "rich>=13.0.0"],
        "dev": ["pytest>=7.0.0", "black", "flake8"],
    },
    entry_points={
        "console_scripts": [
            "saori = kokoro.cli:main",
        ],
    },
)
